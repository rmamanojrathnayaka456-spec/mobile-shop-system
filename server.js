const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: process.env.DB_HOST || 'mysql.railway.internal',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'railway',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

function safeAddColumn(table, columnDefinition) {
    db.query(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`, (err) => {
        if (err && !err.message.includes('Duplicate column')) {
            console.log(`Note on ${table} schema patch:`, err.message);
        }
    });
}

// Auto Create & Patch Tables with Brand and Color
db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50) DEFAULT 'Generic',
        color VARCHAR(30) DEFAULT 'N/A',
        category VARCHAR(50) NOT NULL,
        cost_price DECIMAL(10,2) NOT NULL,
        selling_price DECIMAL(10,2) NOT NULL,
        stock_quantity INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error("❌ Error creating products table:", err.message);
    } else {
        safeAddColumn('products', "brand VARCHAR(50) DEFAULT 'Generic'");
        safeAddColumn('products', "color VARCHAR(30) DEFAULT 'N/A'");
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS phone_stock (
        stock_id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        imei_number VARCHAR(50) UNIQUE NOT NULL,
        status ENUM('Available', 'Sold') DEFAULT 'Available',
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        invoice_id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(15),
        total_amount DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS sale_items (
        sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id INT,
        product_id INT,
        imei_number VARCHAR(50) DEFAULT 'N/A',
        quantity INT DEFAULT 1,
        selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        warranty_months INT DEFAULT 0
    )
`, () => {
    safeAddColumn('sale_items', "imei_number VARCHAR(50) DEFAULT 'N/A'");
    safeAddColumn('sale_items', "quantity INT DEFAULT 1");
    safeAddColumn('sale_items', "selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00");
    safeAddColumn('sale_items', "discount_amount DECIMAL(10,2) DEFAULT 0.00");
    safeAddColumn('sale_items', "total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00");
    safeAddColumn('sale_items', "warranty_months INT DEFAULT 0");
});

// 1. Add Product Endpoint (Supports Brand & Color)
app.post('/api/products', (req, res) => {
    const { name, brand, color, category, cost_price, selling_price, stock_quantity, imei_number } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            const insertProductQuery = `
                INSERT INTO products (name, brand, color, category, cost_price, selling_price, stock_quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            connection.query(insertProductQuery, [
                name, 
                brand || 'Generic', 
                color || 'N/A', 
                category, 
                cost_price, 
                selling_price, 
                stock_quantity || 1
            ], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Failed to insert product: " + err.message });
                    });
                }

                const newProductId = result.insertId;

                if (imei_number && imei_number.trim() !== '') {
                    const insertIMEIQuery = `
                        INSERT INTO phone_stock (product_id, imei_number, status)
                        VALUES (?, ?, 'Available')
                    `;

                    connection.query(insertIMEIQuery, [newProductId, imei_number.trim()], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(400).json({ error: "IMEI insertion failed or already exists!" });
                            });
                        }

                        connection.commit((err) => {
                            connection.release();
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ message: "Product, Brand, Color & IMEI added successfully!" });
                        });
                    });
                } else {
                    connection.commit((err) => {
                        connection.release();
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ message: "Product added successfully!" });
                    });
                }
            });
        });
    });
});

// 2. Safe Delete Product
app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database error" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            connection.query(`UPDATE sale_items SET product_id = NULL WHERE product_id = ?`, [productId], (err) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Failed to update sale_items references" });
                    });
                }

                connection.query(`DELETE FROM phone_stock WHERE product_id = ?`, [productId], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Failed to delete phone stock" });
                        });
                    }

                    connection.query(`DELETE FROM products WHERE product_id = ?`, [productId], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Failed to delete product" });
                            });
                        }

                        connection.commit((err) => {
                            connection.release();
                            if (err) return res.status(500).json({ error: "