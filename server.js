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

// Auto Create Tables & Columns
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        shop_phone VARCHAR(50) DEFAULT '',
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, () => {
    db.query("ALTER TABLE shops ADD COLUMN shop_phone VARCHAR(50) DEFAULT ''", () => {});
    for (let i = 1; i <= 10; i++) {
        db.query(`INSERT INTO shops (shop_id, shop_name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE shop_id=shop_id`, [i, `Shop ${i}`]);
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
    const defaultUsers = [
        ['system01', 'sysKey@01', 1], ['system02', 'mobPass@02', 2], ['system03', 'shopPin@03', 3],
        ['system04', 'posCode@04', 4], ['system05', 'storeKey@05', 5], ['system06', 'branch@06', 6],
        ['system07', 'login@07', 7], ['system08', 'access@08', 8], ['system09', 'secure@09', 9], ['system10', 'admin@10', 10]
    ];
    defaultUsers.forEach(user => {
        db.query(`INSERT INTO users (username, password, shop_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = VALUES(password)`, user);
    });
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
        amount_paid DECIMAL(10, 2) DEFAULT 0,
        balance_due DECIMAL(10, 2) DEFAULT 0,
        items LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {
    db.query("ALTER TABLE sales ADD COLUMN amount_paid DECIMAL(10, 2) DEFAULT 0", () => {});
    db.query("ALTER TABLE sales ADD COLUMN balance_due DECIMAL(10, 2) DEFAULT 0", () => {});
    db.query("ALTER TABLE sales ADD COLUMN items LONGTEXT", () => {});
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
`);

db.query(`
    CREATE TABLE IF NOT EXISTS external_shop_items (
        item_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        target_shop_name VARCHAR(100),
        target_shop_phone VARCHAR(50),
        item_name VARCHAR(255),
        imei VARCHAR(100),
        cost_price DECIMAL(10,2),
        expected_price DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'Given',
        given_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sold_date TIMESTAMP NULL
    )
`);

// Login API
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    db.query(`
        SELECT u.*, s.shop_name, s.shop_phone, s.status 
        FROM users u 
        JOIN shops s ON u.shop_id = s.shop_id 
        WHERE u.username = ? AND u.password = ?
    `, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        const user = results[0];
        if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account Locked.' });

        const finalShopName = custom_shop_name && custom_shop_name.trim() !== '' ? custom_shop_name.trim() : user.shop_name;
        const finalShopPhone = shop_phone && shop_phone.trim() !== '' ? shop_phone.trim() : (user.shop_phone || '');

        db.query('UPDATE shops SET shop_name = ?, shop_phone = ? WHERE shop_id = ?', [finalShopName, finalShopPhone, user.shop_id], () => {
            user.shop_name = finalShopName;
            user.shop_phone = finalShopPhone;
            res.json({ success: true, user });
        });
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

            let parsedItems = [];
            try {
                parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
            } catch (e) { parsedItems = []; }

            return {
                ...row,
                sale_id: realId,
                items: parsedItems,
                delete_key: sqlDateTime,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                amount_paid: row.amount_paid !== null ? parseFloat(row.amount_paid) : parseFloat(row.total_amount || 0),
                balance_due: row.balance_due !== null ? parseFloat(row.balance_due) : 0,
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7)
            };
        });
        res.json(formatted);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, amount_paid, balance_due, items } = req.body;
    
    let containsRepair = false, containsProduct = false;
    if (items && Array.isArray(items)) {
        items.forEach(item => {
            if (item.type === 'repair') containsRepair = true;
            if (item.type === 'product' || item.type === 'exchange' || !item.type) containsProduct = true;
        });
    }
    
    let sale_type = 'Product';
    if (containsRepair && containsProduct) sale_type = 'Mixed';
    else if (containsRepair) sale_type = 'Repair';

    const finalAmountPaid = amount_paid !== undefined ? amount_paid : total_amount;
    const finalBalanceDue = balance_due !== undefined ? balance_due : 0;
    const itemsJson = JSON.stringify(items || []);

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, amount_paid, balance_due, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', sale_type, discount || 0, total_amount, finalAmountPaid, finalBalanceDue, itemsJson],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item.product_id && item.qty) {
                        db.query('UPDATE products SET stock = stock - ? WHERE product_id = ? AND shop_id = ?', [item.qty, item.product_id, shop_id]);
                    } else if (item.type === 'repair' && item.repair_id) {
                        db.query('UPDATE repairs SET status = "Delivered" WHERE repair_id = ? AND shop_id = ?', [item.repair_id, shop_id]);
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

        db.query('UPDATE sales SET amount_paid = ?, balance_due = ? WHERE sale_id = ?', [newPaid, newDue, saleId], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true, new_paid: newPaid, new_due: newDue });
        });
    });
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

// Consignment APIs
app.get('/api/external-items', (req, res) => {
    db.query('SELECT * FROM external_shop_items WHERE shop_id = ? ORDER BY item_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/api/external-items', (req, res) => {
    const { shop_id, target_shop_name, target_shop_phone, item_name, imei, cost_price, expected_price } = req.body;
    db.query(
        'INSERT INTO external_shop_items (shop_id, target_shop_name, target_shop_phone, item_name, imei, cost_price, expected_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, target_shop_name, target_shop_phone, item_name, imei || '', cost_price || 0, expected_price || 0, 'Given'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, item_id: result.insertId });
        }
    );
});

app.put('/api/external-items/:id', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE external_shop_items SET status = ?, sold_date = CURRENT_TIMESTAMP WHERE item_id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/external-items/:id', (req, res) => {
    db.query('DELETE FROM external_shop_items WHERE item_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Restore API
app.post('/api/restore', async (req, res) => {
    const { shop_id, products, sales, repairs } = req.body;
    db.query('DELETE FROM products WHERE shop_id = ?', [shop_id], () => {
        db.query('DELETE FROM sales WHERE shop_id = ?', [shop_id], () => {
            db.query('DELETE FROM repairs WHERE shop_id = ?', [shop_id], () => {
                if (products) products.forEach(p => {
                    db.query('INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [shop_id, p.product_code, p.name, p.brand, p.color, p.category, p.cost_price, p.selling_price, p.stock, p.imei], () => {});
                });
                if (sales) sales.forEach(s => {
                    db.query('INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, amount_paid, balance_due, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [shop_id, s.customer_name, s.customer_phone, s.payment_method, s.sale_type, s.discount, s.total_amount, s.amount_paid, s.balance_due, JSON.stringify(s.items)], () => {});
                });
                if (repairs) repairs.forEach(r => {
                    db.query('INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [shop_id, r.customer_name, r.customer_phone, r.device_model, r.issue_description, r.advance_cost, r.total_cost, r.status], () => {});
                });
                res.json({ success: true, message: 'Restored' });
            });
        });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));