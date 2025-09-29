#!/usr/bin/env node

/**
 * 🗄️ DATA MIGRATION SCRIPT
 * 
 * This script helps migrate your existing JSON data to MongoDB Atlas
 * Run this ONCE after setting up MongoDB Atlas to preserve your existing data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aroma-restaurant';

// Database Models (same as in server.js)
const menuItemSchema = new mongoose.Schema({
  id: Number,
  name: mongoose.Schema.Types.Mixed,
  description: mongoose.Schema.Types.Mixed,
  price: Number,
  category: String,
  image: String,
  video: String,
  thumbnail: String,
  active: { type: Boolean, default: true },
  prepTime: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  id: Number,
  name: String,
  icon: String,
  sort_order: Number,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  id: Number,
  items: [{
    id: Number,
    name: String,
    price: Number,
    qty: Number
  }],
  customerName: String,
  customerEmail: String,
  orderType: String,
  tableNumber: String,
  total: Number,
  discount: { type: Number, default: 0 },
  notes: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const clientSchema = new mongoose.Schema({
  id: Number,
  name: String,
  email: String,
  marketingConsent: { type: Boolean, default: false },
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Category = mongoose.model('Category', categorySchema);
const Order = mongoose.model('Order', orderSchema);
const Client = mongoose.model('Client', clientSchema);

async function migrateData() {
  try {
    console.log('🔄 Starting data migration...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Check if data already exists
    const existingItems = await MenuItem.countDocuments();
    const existingOrders = await Order.countDocuments();
    
    if (existingItems > 0 || existingOrders > 0) {
      console.log('⚠️  Database already contains data. Skipping migration.');
      console.log(`   - Menu Items: ${existingItems}`);
      console.log(`   - Orders: ${existingOrders}`);
      return;
    }

    // Migrate menu data
    const menuDataFile = path.join(__dirname, 'src', 'data', 'menu-data.json');
    const menuDataBackup = path.join(__dirname, 'src', 'menu-data.json');
    
    let menuData = null;
    if (fs.existsSync(menuDataFile)) {
      menuData = JSON.parse(fs.readFileSync(menuDataFile, 'utf8'));
      console.log('📄 Found menu data file');
    } else if (fs.existsSync(menuDataBackup)) {
      menuData = JSON.parse(fs.readFileSync(menuDataBackup, 'utf8'));
      console.log('📄 Found menu data backup file');
    }

    if (menuData) {
      // Migrate categories
      if (menuData.categories && menuData.categories.length > 0) {
        await Category.insertMany(menuData.categories);
        console.log(`✅ Migrated ${menuData.categories.length} categories`);
      }

      // Migrate menu items
      if (menuData.items && menuData.items.length > 0) {
        await MenuItem.insertMany(menuData.items);
        console.log(`✅ Migrated ${menuData.items.length} menu items`);
      }
    }

    // Migrate orders data
    const ordersDataFile = path.join(__dirname, 'src', 'data', 'orders-data.json');
    const ordersDataBackup = path.join(__dirname, 'src', 'orders-data.json');
    
    let ordersData = null;
    if (fs.existsSync(ordersDataFile)) {
      ordersData = JSON.parse(fs.readFileSync(ordersDataFile, 'utf8'));
      console.log('📄 Found orders data file');
    } else if (fs.existsSync(ordersDataBackup)) {
      ordersData = JSON.parse(fs.readFileSync(ordersDataBackup, 'utf8'));
      console.log('📄 Found orders data backup file');
    }

    if (ordersData && ordersData.orders && ordersData.orders.length > 0) {
      await Order.insertMany(ordersData.orders);
      console.log(`✅ Migrated ${ordersData.orders.length} orders`);
    }

    // Migrate clients data
    const clientsDataFile = path.join(__dirname, 'src', 'data', 'clients-data.json');
    const clientsDataBackup = path.join(__dirname, 'src', 'clients-data.json');
    
    let clientsData = null;
    if (fs.existsSync(clientsDataFile)) {
      clientsData = JSON.parse(fs.readFileSync(clientsDataFile, 'utf8'));
      console.log('📄 Found clients data file');
    } else if (fs.existsSync(clientsDataBackup)) {
      clientsData = JSON.parse(fs.readFileSync(clientsDataBackup, 'utf8'));
      console.log('📄 Found clients data backup file');
    }

    if (clientsData && clientsData.length > 0) {
      await Client.insertMany(clientsData);
      console.log(`✅ Migrated ${clientsData.length} clients`);
    }

    console.log('🎉 Data migration completed successfully!');
    console.log('📊 Your data is now safely stored in MongoDB Atlas');
    console.log('🔄 You can now deploy without losing data!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run migration
migrateData();
