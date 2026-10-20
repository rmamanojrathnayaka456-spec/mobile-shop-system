const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Setup using Railway Environment Variables
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

// Auto Create/Update Sales Table Structure
db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        product_id INT,
        quantity INT,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        total_price DECIMAL(10,2),
        imei_number VARCHAR(50),
        sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error("❌ Error creating sales table:", err.message);
    else {
        console.log("✅ Sales table verified.");
        // Alter table if columns are missing from older versions
        db.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20)`, () => {});
        db.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0.00`, () => {});
    }
});

// ------------------- API ENDPOINTS -------------------

// 1. Add Product and IMEI
app.post('/api/products', (req, res) => {
    const { name, category, cost_price, selling_price, stock_quantity, imei_number } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database pool connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction initiation failed: " + err.message });
            }

            const insertProductQuery = `
                INSERT INTO products (name, category, cost_price, selling_price, stock_quantity)
                VALUES (?, ?, ?, ?, ?)
            `;

            connection.query(insertProductQuery, [name, category, cost_price, selling_price, stock_quantity || 1], (err, result) => {
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
                                res.status(400).json({ error: "IMEI insertion failed or IMEI already exists!" });
                            });
                        }

                        connection.commit((err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ error: err.message });
                                });
                            }
                            connection.release();
                            res.json({ message: "Product and IMEI added successfully!" });
                        });
                    });
                } else {
                    connection.commit((err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: err.message });
                            });
                        }
                        connection.release();
                        res.json({ message: "Product added successfully!" });
                    });
                }
            });
        });
    });
});

// 2. Complete Sale / Checkout
app.post('/api/sales', (req, res) => {
    const { customer_name, customer_phone, items } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            let completed = 0;
            items.forEach(item => {
                const insertSale = `
                    INSERT INTO sales (customer_name, customer_phone, product_id, quantity, discount_amount, total_price, imei_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `;

                connection.query(insertSale, [customer_name, customer_phone, item.product_id, item.quantity, item.discount, item.subtotal, item.imei_number], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Sale record failed: " + err.message });
                        });
                    }

                    // Deduct stock quantity
                    const updateStock = `UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?`;
                    connection.query(updateStock, [item.quantity, item.product_id], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Stock update failed" });
                            });
                        }

                        completed++;
                        if (completed === items.length) {
                            connection.commit((err) => {
                                connection.release();
                                if (err) return res.status(500).json({ error: "Commit failed" });
                                res.json({ message: "Sale completed!" });
                            });
                        }
                    });
                });
            });
        });
    });
});

// 3. Fetch Inventory
app.get('/api/inventory', (req, res) => {
    const query = `
        SELECT p.product_id, p.name, p.category, p.stock_quantity, p.selling_price, ps.imei_number
        FROM products p
        LEFT JOIN phone_stock ps ON p.product_id = ps.product_id
        ORDER BY p.product_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. Fetch Sales History
app.get('/api/sales', (req, res) => {
    const query = `
        SELECT s.sale_id, s.customer_name, s.customer_phone, p.name AS product_name, s.quantity, s.discount_amount, s.total_price, s.imei_number
        FROM sales s
        JOIN products p ON s.product_id = p.product_id
        ORDER BY s.sale_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Express 5 RegExp catch-all route
app.get(/.*$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});