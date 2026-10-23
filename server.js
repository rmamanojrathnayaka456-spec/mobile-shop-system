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
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto Create Tables & Robustly Seed 7 Branches and Users
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, (err) => {
    if (!err) {
        const defaultShops = [
            [1, 'Branch 1 - Kegalle', 'ACTIVE'], 
            [2, 'Branch 2 - Rambukkana', 'ACTIVE'], 
            [3, 'Branch 3 - Polgahawela', 'ACTIVE'],
            [4, 'Branch 4 - Mawanella', 'ACTIVE'],
            [5, 'Branch 5 - Kandy', 'ACTIVE'],
            [6, 'Branch 6 - Kurunegala', 'ACTIVE'],
            [7, 'Branch 7 - Colombo', 'ACTIVE']
        ];
        defaultShops.forEach(shop => {
            db.query(`INSERT INTO shops (shop_id, shop_name, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE shop_name = VALUES(shop_name)`, shop);
        });
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        shop_id INT NOT NULL
    )
`, (err) => {
    if (!err) {
        const defaultUsers = [
            ['branch1', 'pass123', 1],
            ['branch2', 'pass123', 2],
            ['branch3', 'pass123', 3],
            ['branch4', 'pass123', 4],
            ['branch5', 'pass123', 5],
            ['branch6', 'pass123', 6],
            ['branch7', 'pass123', 7]
        ];
        defaultUsers.forEach(user => {
            db.query(`INSERT INTO users (username, password, shop_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = VALUES(password), shop_id = VALUES(shop_id)`, user);
        });
    }
});

// Safe Table Creation & Column Migration for Products, Sales, Repairs
db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        product_code VARCHAR(10),
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50),
        color VARCHAR(50),
        category VARCHAR(50),
        cost_price DECIMAL(10, 2),
        selling_price DECIMAL(10, 2) NOT NULL,
        stock INT DEFAULT 1,
        imei VARCHAR(50)
    )
`, () => {
    db.query("ALTER TABLE products ADD COLUMN shop_id INT NOT NULL", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN product_code VARCHAR(10)", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN brand VARCHAR(50)", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN color VARCHAR(50)", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN category VARCHAR(50)", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2)", (err) => {});
    db.query("ALTER TABLE products ADD COLUMN imei VARCHAR(50)", (err) => {});
});

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        payment_method VARCHAR(50),
        discount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {
    db.query("ALTER TABLE sales ADD COLUMN shop_id INT NOT NULL", (err) => {});
});

db.query(`
    CREATE TABLE IF NOT EXISTS repairs (
        repair_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        device_model VARCHAR(100),
        issue_description TEXT,
        advance_cost DECIMAL(10, 2) DEFAULT 0,
        total_cost DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {
    db.query("ALTER TABLE repairs ADD COLUMN shop_id INT NOT NULL", (err) => {});
});

// Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.query(`
        SELECT u.*, s.shop_name, s.status 
        FROM users u 
        JOIN shops s ON u.shop_id = s.shop_id 
        WHERE u.username = ? AND u.password = ?
    `, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        const user = results[0];
        if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account locked due to pending payment.' });
        res.json({ success: true, user });
    });
});

// Products APIs
app.get('/api/products', (req, res) => {
    const shopId = req.query.shop_id;
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query('SELECT COUNT(*) as cnt FROM products WHERE shop_id = ?', [shop_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const product_code = (result[0].cnt + 1).toString().padStart(3, '0');
        db.query(
            'INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shop_id, product_code, name || 'Unknown', brand || 'N/A', color || 'N/A', category || 'General', cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A'],
            (err2, insertResult) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ message: 'Product added successfully', product_id: insertResult.insertId, product_code });
            }
        );
    });
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Product deleted successfully' });
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, items } = req.body;
    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, discount, total_amount) VALUES (?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', discount || 0, total_amount],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    db.query('UPDATE products SET stock = stock - ? WHERE product_id = ? AND shop_id = ?', [item.qty, item.product_id, shop_id]);
                });
            }
            res.json({ message: 'Sale recorded successfully', sale_id: result.insertId });
        }
    );
});

app.delete('/api/sales/:id', (req, res) => {
    db.query('DELETE FROM sales WHERE sale_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Sale removed' });
    });
});

// Repair APIs
app.get('/api/repairs', (req, res) => {
    db.query('SELECT * FROM repairs WHERE shop_id = ? ORDER BY created_at DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Repair added successfully', repair_id: result.insertId });
        }
    );
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));