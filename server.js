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
    host: process.env.DB_HOST || 'mysql-32a1ff4d-rmamanojrathnayaka456-11f5.h.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 19658,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto Create Tables
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        shop_phone VARCHAR(50) DEFAULT '',
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, () => {});

db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT,
        product_code VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        brand VARCHAR(100),
        color VARCHAR(50),
        category VARCHAR(100),
        cost_price DECIMAL(10,2),
        selling_price DECIMAL(10,2),
        stock INT,
        imei VARCHAR(100)
    )
`, () => {});

db.query(`
    CREATE TABLE IF NOT EXISTS repairs (
        repair_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(50),
        device_model VARCHAR(100),
        issue_description TEXT,
        advance_cost DECIMAL(10,2) DEFAULT 0,
        total_cost DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {});

// Sales Table Fresh Creation to fix any schema issues
db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(50),
        payment_method VARCHAR(50),
        discount DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2),
        amount_paid DECIMAL(10,2) DEFAULT 0,
        balance_due DECIMAL(10,2) DEFAULT 0,
        sale_type VARCHAR(50) DEFAULT 'Product',
        items LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {});

db.query(`
    CREATE TABLE IF NOT EXISTS prepared_items (
        item_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(50),
        item_description TEXT,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'Pending Preparation',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {});

// --- API ROUTES ---

app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    db.query('SELECT * FROM shops WHERE shop_name = ?', [custom_shop_name || username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            res.json({ success: true, user: { shop_id: results[0].shop_id, shop_name: results[0].shop_name, shop_phone: results[0].shop_phone } });
        } else {
            db.query('INSERT INTO shops (shop_name, shop_phone) VALUES (?, ?)', [custom_shop_name || username, shop_phone || ''], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, user: { shop_id: result.insertId, shop_name: custom_shop_name || username, shop_phone: shop_phone || '' } });
            });
        }
    });
});

app.get('/api/products', (req, res) => {
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query('SELECT COUNT(*) as cnt FROM products WHERE shop_id = ?', [shop_id], (err, results) => {
        const nextId = (results && results[0] ? results[0].cnt : 0) + 1;
        const product_code = String(nextId).padStart(3, '0');
        
        db.query(
            'INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shop_id, product_code, name, brand, color, category, cost_price || 0, selling_price, stock, imei],
            (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, product_id: result.insertId, product_code });
            }
        );
    });
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/sales', (req, res) => {
    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY sale_id DESC', [req.query.shop_id], (err, results) => {
        if (err) {
            console.error("Sales Fetch Error:", err);
            return res.json([]);
        }
        const formatted = (results || []).map(row => {
            let parsedItems = [];
            try {
                parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
            } catch (e) {
                parsedItems = [];
            }
            
            const dateObj = row.created_at ? new Date(row.created_at) : new Date();
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');

            return {
                ...row,
                items: parsedItems,
                delete_key: row.created_at,
                date_only: `${y}-${m}-${d}`,
                month_only: `${y}-${m}`,
                year_only: `${y}`,
                formatted_date: dateObj.toLocaleString()
            };
        });
        res.json(formatted);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, amount_paid, balance_due, items } = req.body;
    
    let saleType = 'Product';
    if (items && items.length > 0) {
        const hasProd = items.some(i => i.type === 'product' || i.type === 'exchange' || !i.type);
        const hasRep = items.some(i => i.type === 'repair');
        if (hasProd && hasRep) saleType = 'Mixed';
        else if (hasRep) saleType = 'Repair';
    }

    const itemsJson = JSON.stringify(items || []);

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, discount, total_amount, amount_paid, balance_due, sale_type, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            shop_id, 
            customer_name || 'Cash Customer', 
            customer_phone || 'N/A', 
            payment_method || 'Cash', 
            discount || 0, 
            total_amount || 0, 
            amount_paid || total_amount || 0, 
            balance_due || 0, 
            saleType, 
            itemsJson
        ],
        (err, result) => {
            if (err) {
                console.error("Sales Insert Error:", err);
                return res.status(500).json({ error: err.message });
            }
            
            if (items && items.length > 0) {
                items.forEach(item => {
                    if (item.product_id && item.qty) {
                        db.query('UPDATE products SET stock = stock - ? WHERE product_id = ?', [item.qty, item.product_id], () => {});
                    }
                });
            }
            res.json({ success: true, sale_id: result.insertId });
        }
    );
});

app.put('/api/sales/pay-credit/:id', (req, res) => {
    const saleId = req.params.id;
    const { shop_id, paid_amount } = req.body;
    
    db.query('SELECT * FROM sales WHERE sale_id = ? AND shop_id = ?', [saleId, shop_id], (err, results) => {
        if (err || !results || results.length === 0) return res.status(404).json({ error: 'Sale not found' });
        const sale = results[0];
        const newPaid = parseFloat(sale.amount_paid || 0) + parseFloat(paid_amount);
        const newDue = Math.max(0, parseFloat(sale.total_amount) - newPaid);

        db.query('UPDATE sales SET amount_paid = ?, balance_due = ? WHERE sale_id = ?', [newPaid, newDue, saleId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

app.delete('/api/sales/:id', (req, res) => {
    const saleId = req.params.id;
    const shopId = req.query.shop_id;
    
    db.query('DELETE FROM sales WHERE sale_id = ? AND shop_id = ?', [saleId, shopId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/repairs', (req, res) => {
    db.query('SELECT * FROM repairs WHERE shop_id = ? ORDER BY repair_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost || 0, 'Pending'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, repair_id: result.insertId });
        }
    );
});

app.put('/api/repairs/:id', (req, res) => {
    const { status, total_cost } = req.body;
    const query = total_cost !== undefined ? 'UPDATE repairs SET status = ?, total_cost = ? WHERE repair_id = ?' : 'UPDATE repairs SET status = ? WHERE repair_id = ?';
    const params = total_cost !== undefined ? [status, total_cost, req.params.id] : [status, req.params.id];

    db.query(query, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/repairs/:id', (req, res) => {
    db.query('DELETE FROM repairs WHERE repair_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/prepared', (req, res) => {
    db.query('SELECT * FROM prepared_items WHERE shop_id = ? ORDER BY item_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/api/prepared', (req, res) => {
    const { shop_id, customer_name, customer_phone, item_description, notes } = req.body;
    db.query(
        'INSERT INTO prepared_items (shop_id, customer_name, customer_phone, item_description, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name, customer_phone, item_description, notes || '', 'Pending Preparation'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, item_id: result.insertId });
        }
    );
});

app.put('/api/prepared/:id', (req, res) => {
    db.query('UPDATE prepared_items SET status = ? WHERE item_id = ?', [req.body.status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/prepared/:id', (req, res) => {
    db.query('DELETE FROM prepared_items WHERE item_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/restore', (req, res) => {
    const { shop_id, products, sales, repairs } = req.body;
    db.query('DELETE FROM products WHERE shop_id = ?', [shop_id], () => {
        db.query('DELETE FROM sales WHERE shop_id = ?', [shop_id], () => {
            db.query('DELETE FROM repairs WHERE shop_id = ?', [shop_id], () => {
                if (products && products.length > 0) {
                    products.forEach(p => {
                        db.query('INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [shop_id, p.product_code, p.name, p.brand, p.color, p.category, p.cost_price, p.selling_price, p.stock, p.imei], () => {});
                    });
                }
                if (sales && sales.length > 0) {
                    sales.forEach(s => {
                        db.query('INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, discount, total_amount, amount_paid, balance_due, sale_type, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [shop_id, s.customer_name, s.customer_phone, s.payment_method, s.discount, s.total_amount, s.amount_paid, s.balance_due, s.sale_type, JSON.stringify(s.items)], () => {});
                    });
                }
                if (repairs && repairs.length > 0) {
                    repairs.forEach(r => {
                        db.query('INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [shop_id, r.customer_name, r.customer_phone, r.device_model, r.issue_description, r.advance_cost, r.total_cost, r.status], () => {});
                    });
                }
                res.json({ success: true });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});