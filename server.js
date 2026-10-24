const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool
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

// Auto Create Shops & System Accounts (system01 to system10)
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, () => {
    for (let i = 1; i <= 10; i++) {
        const sId = i;
        const sName = `Shop ${i}`;
        db.query(`INSERT INTO shops (shop_id, shop_name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE shop_id=shop_id`, [sId, sName]);
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        shop_id INT NOT NULL
    )
`, () => {
    for (let i = 1; i <= 10; i++) {
        const uName = `system${i.toString().padStart(2, '0')}`;
        db.query(`INSERT INTO users (username, password, shop_id) VALUES (?, 'system321', ?) ON DUPLICATE KEY UPDATE password='system321'`, [uName, i]);
    }
});

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
        selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        stock INT DEFAULT 1,
        imei VARCHAR(50)
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        payment_method VARCHAR(50),
        sale_type VARCHAR(20) DEFAULT 'Product',
        discount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

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
`);

// Login API with Subscription Check & Custom Shop Name Update
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name } = req.body;
    db.query(`
        SELECT u.*, s.shop_name, s.status 
        FROM users u 
        JOIN shops s ON u.shop_id = s.shop_id 
        WHERE u.username = ? AND u.password = ?
    `, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        const user = results[0];
        
        // Subscription Lock Guard
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account Locked. Please contact administrator to renew subscription.' });
        }

        // Update custom shop name if typed
        const finalShopName = custom_shop_name && custom_shop_name.trim() !== '' ? custom_shop_name.trim() : user.shop_name;
        db.query('UPDATE shops SET shop_name = ? WHERE shop_id = ?', [finalShopName, user.shop_id], () => {
            user.shop_name = finalShopName;
            res.json({ success: true, user });
        });
    });
});

// Admin Route to Lock / Unlock Shops
app.post('/api/admin/toggle-lock', (req, res) => {
    const { shop_id, status } = req.body; // status: 'ACTIVE' or 'LOCKED'
    db.query('UPDATE shops SET status = ? WHERE shop_id = ?', [status, shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Shop #${shop_id} status updated to ${status}` });
    });
});

// Products APIs
app.get('/api/products', (req, res) => {
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query(
        'INSERT INTO products (shop_id, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, name || 'Unknown', brand || 'N/A', color || 'N/A', category || 'General', cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const pId = result.insertId;
            const product_code = pId.toString().padStart(3, '0');
            db.query('UPDATE products SET product_code = ? WHERE product_id = ?', [product_code, pId], () => {
                res.json({ message: 'Product added successfully', product_id: pId, product_code });
            });
        }
    );
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'Missing shop_id' });

    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const formatted = (results || []).map((row, index) => {
            const realId = row.sale_id || (index + 1);
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            
            const pad = (n) => String(n).padStart(2, '0');
            const sqlDateTime = `${cDate.getFullYear()}-${pad(cDate.getMonth() + 1)}-${pad(cDate.getDate())} ${pad(cDate.getHours())}:${pad(cDate.getMinutes())}:${pad(cDate.getSeconds())}`;

            return {
                ...row,
                sale_id: realId,
                delete_key: sqlDateTime,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7)
            };
        });
        res.json(formatted);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, items } = req.body;
    
    let containsRepair = false;
    let containsProduct = false;
    if (items && Array.isArray(items)) {
        items.forEach(item => {
            if (item.type === 'repair') containsRepair = true;
            if (item.type === 'product') containsProduct = true;
        });
    }
    
    let sale_type = 'Product';
    if (containsRepair && containsProduct) sale_type = 'Mixed';
    else if (containsRepair) sale_type = 'Repair';

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', sale_type, discount || 0, total_amount],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item.type === 'product' && item.product_id) {
                        db.query('UPDATE products SET stock = stock - ? WHERE product_id = ? AND shop_id = ?', [item.qty, item.product_id, shop_id]);
                    } else if (item.type === 'repair' && item.repair_id) {
                        db.query('UPDATE repairs SET status = "Delivered" WHERE repair_id = ? AND shop_id = ?', [item.repair_id, shop_id]);
                    }
                });
            }
            res.json({ message: 'Sale recorded', sale_id: result.insertId });
        }
    );
});

app.delete('/api/sales/:id', (req, res) => {
    const deleteKey = decodeURIComponent(req.params.id);
    const shopId = req.query.shop_id;
    
    db.query('DELETE FROM sales WHERE created_at = ? AND shop_id = ? LIMIT 1', [deleteKey, shopId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Removed' });
    });
});

// Repairs APIs
app.get('/api/repairs', (req, res) => {
    db.query('SELECT repair_id AS id, repair_id, shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status, created_at FROM repairs WHERE shop_id = ? ORDER BY created_at DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Repair added', repair_id: result.insertId });
        }
    );
});

app.put('/api/repairs/:id', (req, res) => {
    db.query('UPDATE repairs SET status = ? WHERE repair_id = ? AND shop_id = ?', [req.body.status, req.params.id, req.body.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Updated' });
    });
});

app.delete('/api/repairs/:id', (req, res) => {
    db.query('DELETE FROM repairs WHERE repair_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));