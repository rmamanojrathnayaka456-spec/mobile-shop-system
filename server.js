const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// HTML/CSS Static Files Serve කිරීම
app.use(express.static(__dirname));

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '@#Manoj2019217@#', // ඔබේ MySQL Root Password එක
    database: 'mobile_shop_db'
});

db.connect(err => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to MySQL Database!');
});

// Root URL එකට ගිය විට index.html open වීම
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Add New Product
app.post('/api/products', (req, res) => {
    const { name, category, cost_price, selling_price, stock_quantity } = req.body;
    const query = 'INSERT INTO products (name, category, cost_price, selling_price, stock_quantity) VALUES (?, ?, ?, ?, ?)';
    db.query(query, [name, category, cost_price, selling_price, stock_quantity || 0], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'Product Added Successfully!', product_id: result.insertId });
    });
});

// 2. Add IMEI
app.post('/api/phones/add-imei', (req, res) => {
    const { product_id, imei_number } = req.body;
    const query = 'INSERT INTO phone_stock (product_id, imei_number) VALUES (?, ?)';
    db.query(query, [product_id, imei_number], (err, result) => {
        if (err) return res.status(500).json({ error: 'IMEI already exists or Invalid Product ID' });
        db.query('UPDATE products SET stock_quantity = stock_quantity + 1 WHERE product_id = ?', [product_id]);
        res.json({ message: 'IMEI Added Successfully!' });
    });
});

// 3. Get Inventory
app.get('/api/inventory', (req, res) => {
    const query = `
        SELECT p.product_id, p.name, p.category, p.cost_price, p.selling_price, p.stock_quantity, 
               GROUP_CONCAT(ps.imei_number SEPARATOR ', ') AS available_imeis
        FROM products p
        LEFT JOIN phone_stock ps ON p.product_id = ps.product_id AND ps.status = 'Available'
        GROUP BY p.product_id
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// 4. Sales / Invoice Processing
app.post('/api/sales', (req, res) => {
    const { customer_name, customer_phone, total_amount, items } = req.body;
    const salesQuery = 'INSERT INTO sales (customer_name, customer_phone, total_amount) VALUES (?, ?, ?)';
    db.query(salesQuery, [customer_name, customer_phone, total_amount], (err, result) => {
        if (err) return res.status(500).json(err);
        
        const invoiceId = result.insertId;
        items.forEach(item => {
            const itemQuery = 'INSERT INTO sale_items (invoice_id, product_id, imei_number, quantity, selling_price, warranty_months) VALUES (?, ?, ?, ?, ?, ?)';
            db.query(itemQuery, [invoiceId, item.product_id, item.imei_number || 'N/A', item.quantity || 1, item.selling_price, item.warranty_months || 0]);
            
            if (item.imei_number && item.imei_number !== 'N/A') {
                db.query('UPDATE phone_stock SET status = "Sold" WHERE imei_number = ?', [item.imei_number]);
            }
            db.query('UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?', [item.quantity || 1, item.product_id]);
        });

        res.json({ message: 'Sale Completed Successfully!', invoice_id: invoiceId });
    });
});

// 5. Used Phone Management
app.post('/api/used-phones', (req, res) => {
    const { phone_model, imei_number, seller_name, seller_phone, buy_price, selling_price, condition } = req.body;
    const query = 'INSERT INTO used_phones (phone_model, imei_number, seller_name, seller_phone, buy_price, selling_price, `condition`) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [phone_model, imei_number, seller_name, seller_phone, buy_price, selling_price, condition], (err, result) => {
        if (err) return res.status(500).json({ error: 'IMEI already exists or DB Error' });
        res.json({ message: 'Used Phone Added Successfully!' });
    });
});

app.get('/api/used-phones', (req, res) => {
    db.query('SELECT * FROM used_phones WHERE status = "Available"', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// 6. Sell Used Phone
app.post('/api/sell-used-phone', (req, res) => {
    const { used_phone_id, customer_name, customer_phone, selling_price, warranty_months } = req.body;
    
    db.query('SELECT * FROM used_phones WHERE used_phone_id = ? AND status = "Available"', [used_phone_id], (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ error: 'Used Phone not available or ID invalid' });

        const phone = results[0];
        const salesQuery = 'INSERT INTO sales (customer_name, customer_phone, total_amount) VALUES (?, ?, ?)';
        db.query(salesQuery, [customer_name, customer_phone, selling_price], (err, salesResult) => {
            if (err) return res.status(500).json(err);
            const invoiceId = salesResult.insertId;

            db.query('UPDATE used_phones SET status = "Sold" WHERE used_phone_id = ?', [used_phone_id]);

            res.json({ 
                message: 'Used Phone Sold Successfully!', 
                invoice_id: invoiceId, 
                phone_model: phone.phone_model, 
                imei_number: phone.imei_number 
            });
        });
    });
});

// 7. Daily & Monthly Sales Reports
app.get('/api/reports/sales', (req, res) => {
    const queryDaily = `
        SELECT DATE(created_at) as date, COUNT(invoice_id) as total_sales, SUM(total_amount) as total_revenue 
        FROM sales 
        WHERE DATE(created_at) = CURDATE() 
        GROUP BY DATE(created_at)
    `;

    const queryMonthly = `
        SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(invoice_id) as total_sales, SUM(total_amount) as total_revenue 
        FROM sales 
        WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    `;

    db.query(queryDaily, (err, dailyResults) => {
        if (err) return res.status(500).json(err);
        db.query(queryMonthly, (err, monthlyResults) => {
            if (err) return res.status(500).json(err);
            res.json({
                daily: dailyResults[0] || { total_sales: 0, total_revenue: 0 },
                monthly: monthlyResults[0] || { total_sales: 0, total_revenue: 0 }
            });
        });
    });
});

app.get('/api/sales-history', (req, res) => {
    const query = `
        SELECT s.invoice_id, s.customer_name, s.customer_phone, s.total_amount, s.created_at
        FROM sales s
        ORDER BY s.invoice_id DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});