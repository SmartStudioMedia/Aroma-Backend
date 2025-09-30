/**
 * Database Management Module
 * 
 * Handles all database operations with proper persistence and migration
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aroma-restaurant';

// Database Models
const menuItemSchema = new mongoose.Schema({
  id: Number,
  name: mongoose.Schema.Types.Mixed,
  description: mongoose.Schema.Types.Mixed,
  price: Number,
  category_id: Number,
  image: String,
  video: String,
  thumbnail: String,
  active: { type: Boolean, default: true },
  ingredients: mongoose.Schema.Types.Mixed,
  nutrition: mongoose.Schema.Types.Mixed,
  allergies: mongoose.Schema.Types.Mixed,
  prepTime: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  id: Number,
  name: mongoose.Schema.Types.Mixed,
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
    name: mongoose.Schema.Types.Mixed,
    price: Number,
    quantity: Number,
    category_id: Number
  }],
  customerName: String,
  customerEmail: String,
  orderType: String,
  tableNumber: String,
  marketingConsent: Boolean,
  total: Number,
  discount: Number,
  status: String,
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

// Helper function to generate multilingual translations
function generateMultilingualTranslations(text, type = 'item') {
  if (typeof text !== 'string') {
    return text; // Already multilingual
  }
  
  const commonTranslations = {
    // Food categories
    'Burgers': { en: 'Burgers', mt: 'Burgers', es: 'Hamburguesas', it: 'Hamburger', fr: 'Hamburgers', de: 'Burger', ru: 'Бургеры', pt: 'Hambúrgueres', nl: 'Burgers', pl: 'Burgery' },
    'Sides': { en: 'Sides', mt: 'Sides', es: 'Acompañamientos', it: 'Contorni', fr: 'Accompagnements', de: 'Beilagen', ru: 'Гарниры', pt: 'Acompanhamentos', nl: 'Bijgerechten', pl: 'Dodatki' },
    'Drinks': { en: 'Drinks', mt: 'Xorb', es: 'Bebidas', it: 'Bevande', fr: 'Boissons', de: 'Getränke', ru: 'Напитки', pt: 'Bebidas', nl: 'Dranken', pl: 'Napoje' },
    'Desserts': { en: 'Desserts', mt: 'Desserts', es: 'Postres', it: 'Dolci', fr: 'Desserts', de: 'Desserts', ru: 'Десерты', pt: 'Sobremesas', nl: 'Desserts', pl: 'Desery' },
    'Pizza': { en: 'Pizza', mt: 'Pizza', es: 'Pizza', it: 'Pizza', fr: 'Pizza', de: 'Pizza', ru: 'Пицца', pt: 'Pizza', nl: 'Pizza', pl: 'Pizza' },
    'Salads': { en: 'Salads', mt: 'Insalata', es: 'Ensaladas', it: 'Insalate', fr: 'Salades', de: 'Salate', ru: 'Салаты', pt: 'Saladas', nl: 'Salades', pl: 'Sałatki' }
  };
  
  // Try to find exact match first
  if (commonTranslations[text]) {
    return commonTranslations[text];
  }
  
  // Try partial matching for compound names
  const normalizedText = text.toLowerCase();
  for (const [key, translations] of Object.entries(commonTranslations)) {
    if (normalizedText.includes(key.toLowerCase())) {
      return translations;
    }
  }
  
  // If no translation found, create basic multilingual structure
  const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
  const result = {};
  languages.forEach(lang => {
    result[lang] = text; // Default to original text for all languages
  });
  
  return result;
}

// Connect to database
async function connectToDatabase() {
  try {
    console.log('🔍 Checking MongoDB configuration...');
    console.log('MONGODB_URI exists:', !!MONGODB_URI);
    console.log('MONGODB_URI value:', MONGODB_URI ? MONGODB_URI.substring(0, 20) + '...' : 'undefined');
    
    // Only connect if MONGODB_URI is properly configured
    if (!MONGODB_URI || MONGODB_URI === 'mongodb://localhost:27017/aroma-restaurant' || MONGODB_URI.includes('localhost')) {
      console.log('🔄 No MongoDB Atlas URI configured, using file-based storage');
      console.log('💡 To enable permanent data storage, set MONGODB_URI environment variable');
      console.log('💡 Example: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database');
      console.log('⚠️  WARNING: Data will be lost on server restart without MongoDB!');
      return false;
    }
    
    console.log('🔄 Attempting to connect to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas successfully');
    console.log('🗄️ Your data is now stored permanently in the cloud!');
    
    // Test the connection by checking if we can access the database
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('📊 Available collections:', collections.map(c => c.name));
    
    // Run migrations
    await runMigrations();
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    console.log('🔄 Falling back to file-based storage...');
    console.log('💡 Check your MONGODB_URI environment variable in Railway');
    return false;
  }
}

// Run database migrations
async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...');
    
    // Migrate categories
    const categoriesWithStringNames = await Category.find({ 
      name: { $type: 'string' },
      'name.en': { $exists: false }
    });
    
    if (categoriesWithStringNames.length > 0) {
      console.log('🔄 Converting string category names to multilingual...');
      for (const category of categoriesWithStringNames) {
        const multilingualName = generateMultilingualTranslations(category.name, 'category');
        await Category.findByIdAndUpdate(category._id, { name: multilingualName });
        console.log(`✅ Fixed category ${category.id}: ${category.name} -> multilingual`);
      }
    }
    
    // Migrate menu items
    const itemsWithStringNames = await MenuItem.find({ 
      name: { $type: 'string' },
      'name.en': { $exists: false }
    });
    
    if (itemsWithStringNames.length > 0) {
      console.log('🔄 Converting string item names to multilingual...');
      for (const item of itemsWithStringNames) {
        const multilingualName = generateMultilingualTranslations(item.name, 'item');
        await MenuItem.findByIdAndUpdate(item._id, { name: multilingualName });
        console.log(`✅ Fixed item ${item.id}: ${item.name} -> multilingual`);
      }
    }
    
    // Seed default data if collections are empty
    await seedDefaultData();
    
    console.log('✅ Database migrations completed');
  } catch (error) {
    console.error('❌ Error running migrations:', error);
  }
}

// Seed default data
async function seedDefaultData() {
  try {
    console.log('🔄 Checking for default data...');
    
    // Check if categories exist
    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
      console.log('🔄 Seeding default categories...');
      const defaultCategories = [
        { id: 1, name: generateMultilingualTranslations('Burgers', 'category'), icon: '🍔', sort_order: 1, active: true },
        { id: 2, name: generateMultilingualTranslations('Sides', 'category'), icon: '🍟', sort_order: 2, active: true },
        { id: 3, name: generateMultilingualTranslations('Drinks', 'category'), icon: '🥤', sort_order: 3, active: true },
        { id: 4, name: generateMultilingualTranslations('Desserts', 'category'), icon: '🍰', sort_order: 4, active: true },
        { id: 5, name: generateMultilingualTranslations('Pizza', 'category'), icon: '🍕', sort_order: 5, active: true },
        { id: 6, name: generateMultilingualTranslations('Salads', 'category'), icon: '🥗', sort_order: 6, active: true }
      ];
      
      await Category.insertMany(defaultCategories);
      console.log('✅ Default categories created');
    }
    
    // Check if menu items exist
    const itemCount = await MenuItem.countDocuments();
    if (itemCount === 0) {
      console.log('🔄 Seeding default menu items...');
      const defaultItems = [
        {
          id: 1,
          name: generateMultilingualTranslations('Classic Burger', 'item'),
          description: generateMultilingualTranslations('A delicious classic burger with fresh ingredients', 'item'),
          price: 12.99,
          category_id: 1,
          image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
          active: true,
          ingredients: generateMultilingualTranslations('Beef patty, lettuce, tomato, onion, pickles', 'item'),
          nutrition: generateMultilingualTranslations('High protein, moderate carbs', 'item'),
          allergies: generateMultilingualTranslations('Contains gluten, dairy', 'item'),
          prepTime: generateMultilingualTranslations('15 minutes', 'item')
        },
        {
          id: 2,
          name: generateMultilingualTranslations('French Fries', 'item'),
          description: generateMultilingualTranslations('Crispy golden french fries', 'item'),
          price: 4.99,
          category_id: 2,
          image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400',
          active: true,
          ingredients: generateMultilingualTranslations('Potatoes, salt, oil', 'item'),
          nutrition: generateMultilingualTranslations('High carbs, moderate fat', 'item'),
          allergies: generateMultilingualTranslations('None', 'item'),
          prepTime: generateMultilingualTranslations('10 minutes', 'item')
        }
      ];
      
      await MenuItem.insertMany(defaultItems);
      console.log('✅ Default menu items created');
    }
    
  } catch (error) {
    console.error('❌ Error seeding default data:', error);
  }
}

// Load data from database
async function loadDataFromDatabase() {
  try {
    if (mongoose.connection.readyState !== 1) {
      return null;
    }
    
    console.log('🔄 Loading data from MongoDB...');
    
    const categories = await Category.find().sort({ sort_order: 1 });
    const items = await MenuItem.find().sort({ id: 1 });
    const orders = await Order.find().sort({ createdAt: -1 });
    const clients = await Client.find().sort({ createdAt: -1 });
    
    console.log(`✅ Loaded from MongoDB - Categories: ${categories.length}, Items: ${items.length}, Orders: ${orders.length}, Clients: ${clients.length}`);
    
    return {
      categories: categories.map(cat => cat.toObject()),
      items: items.map(item => item.toObject()),
      orders: orders.map(order => order.toObject()),
      clients: clients.map(client => client.toObject())
    };
  } catch (error) {
    console.error('❌ Error loading data from database:', error);
    return null;
  }
}

// Save data to database
async function saveDataToDatabase(data) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return false;
    }
    
    // Save categories
    if (data.categories) {
      for (const category of data.categories) {
        await Category.findOneAndUpdate({ id: category.id }, category, { upsert: true });
      }
    }
    
    // Save items
    if (data.items) {
      for (const item of data.items) {
        await MenuItem.findOneAndUpdate({ id: item.id }, item, { upsert: true });
      }
    }
    
    // Save orders
    if (data.orders) {
      for (const order of data.orders) {
        await Order.findOneAndUpdate({ id: order.id }, order, { upsert: true });
      }
    }
    
    // Save clients
    if (data.clients) {
      for (const client of data.clients) {
        await Client.findOneAndUpdate({ id: client.id }, client, { upsert: true });
      }
    }
    
    console.log('✅ Data saved to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ Error saving data to database:', error);
    return false;
  }
}

module.exports = {
  connectToDatabase,
  runMigrations,
  seedDefaultData,
  loadDataFromDatabase,
  saveDataToDatabase,
  generateMultilingualTranslations,
  MenuItem,
  Category,
  Order,
  Client
};
