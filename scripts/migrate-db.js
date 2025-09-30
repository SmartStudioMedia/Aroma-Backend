#!/usr/bin/env node

/**
 * Database Migration and Seed Script
 * 
 * This script ensures data persistence and handles migrations safely.
 * Run with: node scripts/migrate-db.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

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

const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Category = mongoose.model('Category', categorySchema);

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

async function migrateDatabase() {
  try {
    console.log('🔄 Starting database migration...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Check if we need to migrate from file storage
    const fs = require('fs');
    const path = require('path');
    
    const MENU_DATA_FILE = path.join(__dirname, '../src/data/menu-data.json');
    const MENU_DATA_BACKUP = path.join(__dirname, '../src/menu-data.json');
    
    let fileData = null;
    if (fs.existsSync(MENU_DATA_FILE)) {
      fileData = JSON.parse(fs.readFileSync(MENU_DATA_FILE, 'utf8'));
    } else if (fs.existsSync(MENU_DATA_BACKUP)) {
      fileData = JSON.parse(fs.readFileSync(MENU_DATA_BACKUP, 'utf8'));
    }
    
    // Migrate categories
    if (fileData && fileData.categories) {
      console.log('🔄 Migrating categories...');
      for (const category of fileData.categories) {
        // Ensure category name is multilingual
        const multilingualName = generateMultilingualTranslations(category.name, 'category');
        
        await Category.findOneAndUpdate(
          { id: category.id },
          {
            id: category.id,
            name: multilingualName,
            icon: category.icon || '🍽️',
            sort_order: category.sort_order || category.id,
            active: category.active !== false
          },
          { upsert: true }
        );
      }
      console.log(`✅ Migrated ${fileData.categories.length} categories`);
    }
    
    // Migrate menu items
    if (fileData && fileData.items) {
      console.log('🔄 Migrating menu items...');
      for (const item of fileData.items) {
        // Ensure item fields are multilingual
        const multilingualName = generateMultilingualTranslations(item.name, 'item');
        const multilingualDescription = generateMultilingualTranslations(item.description, 'item');
        const multilingualIngredients = generateMultilingualTranslations(item.ingredients, 'item');
        const multilingualNutrition = generateMultilingualTranslations(item.nutrition, 'item');
        const multilingualAllergies = generateMultilingualTranslations(item.allergies, 'item');
        const multilingualPrepTime = generateMultilingualTranslations(item.prepTime, 'item');
        
        await MenuItem.findOneAndUpdate(
          { id: item.id },
          {
            id: item.id,
            name: multilingualName,
            description: multilingualDescription,
            price: item.price,
            category_id: item.category_id,
            image: item.image,
            video: item.video,
            thumbnail: item.thumbnail,
            active: item.active !== false,
            ingredients: multilingualIngredients,
            nutrition: multilingualNutrition,
            allergies: multilingualAllergies,
            prepTime: multilingualPrepTime
          },
          { upsert: true }
        );
      }
      console.log(`✅ Migrated ${fileData.items.length} menu items`);
    }
    
    // Seed default data if collections are empty
    await seedDefaultData();
    
    console.log('✅ Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

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

// Run migration if called directly
if (require.main === module) {
  migrateDatabase();
}

module.exports = { migrateDatabase, seedDefaultData };
