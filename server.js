const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: {
        rejectUnauthorized: false // Aiven MySQL සඳහා SSL අනිවාර්ය වේ
    },
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

// Auto Create & Patch Tables
db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50) DEFAULT 'Generic',
        color VARCHAR(50) DEFAULT 'N/A',
        category VARCHAR(50) NOT NULL,
        model_number VARCHAR(100) DEFAULT 'N/A',
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
        safeAddColumn('products', "color VARCHAR(50) DEFAULT 'N/A'");
        safeAddColumn('products', "model_number VARCHAR(100) DEFAULT 'N/A'");
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
        warranty_months INT DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES sales(invoice_id) ON DELETE CASCADE
    )
`, () => {
    safeAddColumn('sale_items', "imei_number VARCHAR(50) DEFAULT 'N/A'");
    safeAddColumn('sale_items', "quantity INT DEFAULT 1");
    safeAddColumn('sale_items', "selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00");
    safeAddColumn('sale_items', "discount_amount DECIMAL(10,2) DEFAULT 0.00");
    safeAddColumn('sale_items', "total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00");
    safeAddColumn('sale_items', "warranty_months INT DEFAULT 0");
});

// 1. Add Product Endpoint
app.post('/api/products', (req, res) => {
    const { name, brand, color, category, model_number, cost_price, selling_price, stock_quantity, imei_number } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            const insertProductQuery = `
                INSERT INTO products (name, brand, color, category, model_number, cost_price, selling_price, stock_quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            connection.query(insertProductQuery, [
                name || brand + " " + (model_number !== 'N/A' ? model_number : ''), 
                brand || 'Generic', 
                color || 'N/A', 
                category || 'Phone',
                model_number || 'N/A', 
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
                const formattedId = String(newProductId).padStart(3, '0');

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
                            res.json({ message: `Product added successfully with Product ID: ${formattedId}` });
                        });
                    });
                } else {
                    connection.commit((err) => {
                        connection.release();
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ message: `Product added successfully with Product ID: ${formattedId}` });
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
                            if (err) return res.status(500).json({ error: "Commit failed" });
                            res.json({ message: `Product ID ${String(productId).padStart(3, '0')} deleted successfully!` });
                        });
                    });
                });
            });
        });
    });
});

// 3. Complete Sale / Checkout
app.post('/api/sales', (req, res) => {
    const { customer_name, customer_phone, items } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: "Cart is empty" });

    const grandTotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            const insertSalesHeader = `INSERT INTO sales (customer_name, customer_phone, total_amount) VALUES (?, ?, ?)`;

            connection.query(insertSalesHeader, [customer_name || 'Cash Customer', customer_phone || 'N/A', grandTotal], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Sales header creation failed" });
                    });
                }

                const invoiceId = result.insertId;
                let completedItems = 0;

                items.forEach(item => {
                    const insertSaleItem = `
                        INSERT INTO sale_items (invoice_id, product_id, imei_number, quantity, selling_price, discount_amount, total_price, warranty_months)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    connection.query(insertSaleItem, [
                        invoiceId, item.product_id, item.imei_number || 'N/A', item.quantity || 1, item.price, item.discount || 0, item.subtotal, item.warranty_months || 0
                    ], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Sale item insertion failed" });
                            });
                        }

                        connection.query(`UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?`, [item.quantity, item.product_id], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ error: "Stock update failed" });
                                });
                            }

                            if (item.imei_number && item.imei_number !== 'N/A') {
                                connection.query(`UPDATE phone_stock SET status = 'Sold' WHERE imei_number = ?`, [item.imei_number], () => {});
                            }

                            completedItems++;
                            if (completedItems === items.length) {
                                connection.commit((err) => {
                                    connection.release();
                                    if (err) return res.status(500).json({ error: "Commit failed" });
                                    res.json({ message: "Sale completed successfully!", invoice_id: invoiceId });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});

// 4. Delete Single Sale Endpoint
app.delete('/api/sales/:sale_item_id', (req, res) => {
    const saleItemId = req.params.sale_item_id;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database error" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            // Get sale item details to restore stock
            connection.query(`SELECT product_id, quantity, imei_number FROM sale_items WHERE sale_item_id = ?`, [saleItemId], (err, results) => {
                if (err || results.length === 0) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(404).json({ error: "Sale record not found" });
                    });
                }

                const item = results[0];

                // Restore product quantity
                connection.query(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?`, [item.quantity, item.product_id], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Failed to restore stock quantity" });
                        });
                    }

                    // Restore IMEI if phone
                    if (item.imei_number && item.imei_number !== 'N/A') {
                        connection.query(`UPDATE phone_stock SET status = 'Available' WHERE imei_number = ?`, [item.imei_number], () => {});
                    }

                    // Delete the sale item
                    connection.query(`DELETE FROM sale_items WHERE sale_item_id = ?`, [saleItemId], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Failed to delete sale record" });
                            });
                        }

                        connection.commit((err) => {
                            connection.release();
                            if (err) return res.status(500).json({ error: "Commit failed" });
                            res.json({ message: "Sale record deleted and stock restored successfully!" });
                        });
                    });
                });
            });
        });
    });
});

// 5. Fetch Inventory
app.get('/api/inventory', (req, res) => {
    const query = `
        SELECT 
            p.product_id, 
            LPAD(p.product_id, 3, '0') AS formatted_id,
            p.name, 
            p.brand, 
            p.color, 
            p.category, 
            p.model_number, 
            p.stock_quantity, 
            p.selling_price, 
            ps.imei_number
        FROM products p
        LEFT JOIN phone_stock ps ON p.product_id = ps.product_id AND ps.status = 'Available'
        ORDER BY p.product_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 6. Fetch Detailed Sales History
app.get('/api/sales', (req, res) => {
    const query = `
        SELECT 
            si.sale_item_id,
            s.invoice_id AS sale_id, 
            s.customer_name, 
            s.customer_phone, 
            p.name AS product_name, 
            si.quantity, 
            si.discount_amount, 
            si.total_price, 
            si.imei_number,
            s.created_at
        FROM sales s
        JOIN sale_items si ON s.invoice_id = si.invoice_id
        LEFT JOIN products p ON si.product_id = p.product_id
        ORDER BY si.sale_item_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 7. Fetch Sales Summary Statistics (Daily, Monthly, Most Sold)
app.get('/api/sales/summary', (req, res) => {
    const dailyQuery = `
        SELECT COALESCE(SUM(total_amount), 0) AS daily_total 
        FROM sales 
        WHERE DATE(created_at) = CURDATE()
    `;

    const monthlyQuery = `
        SELECT COALESCE(SUM(total_amount), 0) AS monthly_total 
        FROM sales 
        WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())
    `;

    const topItemsQuery = `
        SELECT p.name AS product_name, SUM(si.quantity) AS total_sold
        FROM sale_items si
        JOIN sales s ON si.invoice_id = s.invoice_id
        LEFT JOIN products p ON si.product_id = p.product_id
        WHERE MONTH(s.created_at) = MONTH(CURRENT_DATE()) AND YEAR(s.created_at) = YEAR(CURRENT_DATE())
        GROUP BY si.product_id, p.name
        ORDER BY total_sold DESC
        LIMIT 5
    `;

    db.query(dailyQuery, (err, dailyRes) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query(monthlyQuery, (err, monthlyRes) => {
            if (err) return res.status(500).json({ error: err.message });

            db.query(topItemsQuery, (err, topItemsRes) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                    daily_total: dailyRes[0].daily_total,
                    monthly_total: monthlyRes[0].monthly_total,
                    most_sold_items: topItemsRes
                });
            });
        });
    });
});

app.get(/.*$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});