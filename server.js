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

// Auto-create & Auto-patch Tables to sync missing columns automatically
db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        cost_price DECIMAL(10,2) NOT NULL,
        selling_price DECIMAL(10,2) NOT NULL,
        stock_quantity INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error("❌ Error creating products table:", err.message);
});

db.query(`
    CREATE TABLE IF NOT EXISTS phone_stock (
        stock_id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        imei_number VARCHAR(50) UNIQUE NOT NULL,
        status ENUM('Available', 'Sold') DEFAULT 'Available',
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
    )
`, (err) => {
    if (err) console.error("❌ Error creating phone_stock table:", err.message);
});

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        invoice_id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(15),
        total_amount DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error("❌ Error creating sales table:", err.message);
});

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
`, (err) => {
    if (err) {
        console.error("❌ Error creating sale_items table:", err.message);
    } else {
        console.log("✅ Patching all sale_items columns on Railway DB...");
        
        // Force add all potentially missing columns directly to the live Railway DB
        const alterQueries = [
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS imei_number VARCHAR(50) DEFAULT 'N/A'`,
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1`,
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00`,
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0.00`,
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00`,
            `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS warranty_months INT DEFAULT 0`
        ];

        alterQueries.forEach(query => {
            db.query(query, (err) => {
                // Ignore column exists errors
            });
        });
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

// 2. Delete Product from Stock Inventory
app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database error" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction failed" });
            }

            connection.query(`DELETE FROM phone_stock WHERE product_id = ?`, [productId], (err) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Failed to delete phone stock: " + err.message });
                    });
                }

                connection.query(`DELETE FROM products WHERE product_id = ?`, [productId], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: "Failed to delete product: " + err.message });
                        });
                    }

                    connection.commit((err) => {
                        connection.release();
                        if (err) return res.status(500).json({ error: "Commit failed" });
                        res.json({ message: `Product ID ${productId} deleted successfully!` });
                    });
                });
            });
        });
    });
});

// 3. Complete Sale / Checkout
app.post('/api/sales', (req, res) => {
    const { customer_name, customer_phone, items } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }

    const grandTotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction initiation failed" });
            }

            const insertSalesHeader = `
                INSERT INTO sales (customer_name, customer_phone, total_amount)
                VALUES (?, ?, ?)
            `;

            connection.query(insertSalesHeader, [customer_name || 'Cash Customer', customer_phone || 'N/A', grandTotal], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Sales header creation failed: " + err.message });
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
                        invoiceId, 
                        item.product_id, 
                        item.imei_number || 'N/A', 
                        item.quantity || 1, 
                        item.price, 
                        item.discount || 0, 
                        item.subtotal, 
                        item.warranty_months || 0
                    ], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Sale item insertion failed: " + err.message });
                            });
                        }

                        const updateStock = `UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?`;
                        connection.query(updateStock, [item.quantity, item.product_id], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ error: "Stock update failed" });
                                });
                            }

                            if (item.imei_number) {
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

// 4. Fetch Inventory
app.get('/api/inventory', (req, res) => {
    const query = `
        SELECT p.product_id, p.name, p.category, p.stock_quantity, p.selling_price, ps.imei_number
        FROM products p
        LEFT JOIN phone_stock ps ON p.product_id = ps.product_id AND ps.status = 'Available'
        ORDER BY p.product_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. Fetch Sales History
app.get('/api/sales', (req, res) => {
    const query = `
        SELECT 
            s.invoice_id AS sale_id, 
            s.customer_name, 
            s.customer_phone, 
            p.name AS product_name, 
            si.quantity, 
            si.discount_amount, 
            si.total_price, 
            si.imei_number
        FROM sales s
        JOIN sale_items si ON s.invoice_id = si.invoice_id
        LEFT JOIN products p ON si.product_id = p.product_id
        ORDER BY s.invoice_id DESC
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