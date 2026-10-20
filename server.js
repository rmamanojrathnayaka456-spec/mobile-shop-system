const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // public folder එක static ලෙස serve කිරීම

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

// Test Database Connection
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Connected to Railway MySQL Database successfully!');
        connection.release();
    }
});

// ------------------- API ENDPOINTS -------------------

// 1. Add Product and IMEI (Atomic Transaction)
app.post('/api/products', (req, res) => {
    const { name, category, cost_price, selling_price, stock_quantity, imei_number } = req.body;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database pool connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction initiation failed: " + err.message });
            }

            // Step A: Insert into products table
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

                // Step B: Insert IMEI into phone_stock table if IMEI is provided
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
                    // No IMEI provided (For Accessories/JBL)
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

// 2. Fetch Stock Inventory
app.get('/api/inventory', (req, res) => {
    const query = `
        SELECT p.product_id, p.name, p.category, p.stock_quantity, p.selling_price, ps.imei_number
        FROM products p
        LEFT JOIN phone_stock ps ON p.product_id = ps.product_id
        ORDER BY p.product_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: "Failed to fetch inventory: " + err.message });
        }
        res.json(results);
    });
});

// Serve frontend on root URL
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});