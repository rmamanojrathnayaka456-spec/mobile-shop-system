const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool with Aiven SSL Support
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto Create Tables & Seed Default Shops & Users
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL
    )
`, (err) => {
    if (!err) {
        db.query(`INSERT IGNORE INTO shops (shop_id, shop_name) VALUES 
            (1, 'SHA Mobile - Main Branch (Kegalle)'), 
            (2, 'SHA Mobile - Branch 2 (Rambukkana)'), 
            (3, 'SHA Mobile - Branch 3')`, () => {
                // Seed Users for each branch
                db.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        user_id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        password VARCHAR(50) NOT NULL,
                        shop_id INT NOT NULL,
                        FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
                    )
                `, (err2) => {
                    if(!err2) {
                        db.query(`INSERT IGNORE INTO users (username, password, shop_id) VALUES 
                            ('kegalle', 'kegalle123', 1),
                            ('rambukkana', 'rambukkana123', 2),
                            ('branch3', 'branch123', 3)`);
                    }
                });
            });
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50),
        color VARCHAR(50),
        category VARCHAR(50),
        cost_price DECIMAL(10, 2),
        selling_price DECIMAL(10, 2) NOT NULL,
        stock INT DEFAULT 1,
        imei VARCHAR(50),
        FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        total_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
    )
`);

// Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT u.*, s.shop_name FROM users u JOIN shops s ON u.shop_id = s.shop_id WHERE u.username = ? AND u.password = ?', 
    [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        res.json({ success: true, user: results[0] });
    });
});

// Products APIs
app.get('/api/products', (req, res) => {
    const shopId = req.query.shop_id;
    db.query('SELECT * FROM products WHERE shop_id = ?', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query(
        'INSERT INTO products (shop_id, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, name, brand, color, category, cost_price, selling_price, stock || 1, imei],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Product added successfully', product_id: result.insertId });
        }
    );
});

app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    const shopId = req.query.shop_id;
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [productId, shopId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Product deleted successfully' });
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id;
    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, total_amount } = req.body;
    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, total_amount) VALUES (?, ?, ?, ?)',
        [shop_id, customer_name || 'Cash Customer', customer_phone || 'N/A', total_amount],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Sale recorded successfully', sale_id: result.insertId });
        }
    );
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});