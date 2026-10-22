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

// Auto Create Tables with shop_id and Seed 3 Branches
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
            (3, 'SHA Mobile - Branch 3')`);
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50),
        color VARCHAR(50),
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
        total_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
    )
`);

// API Endpoints
app.get('/api/shops', (req, res) => {
    db.query('SELECT * FROM shops', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/products', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT * FROM products WHERE shop_id = ?', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, cost_price, selling_price, stock, imei } = req.body;
    db.query(
        'INSERT INTO products (shop_id, name, brand, color, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, name, brand, color, cost_price, selling_price, stock || 1, imei],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Product added successfully', product_id: result.insertId });
        }
    );
});

app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, total_amount } = req.body;
    db.query(
        'INSERT INTO sales (shop_id, total_amount) VALUES (?, ?)',
        [shop_id, total_amount],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Sale recorded successfully', sale_id: result.insertId });
        }
    );
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});