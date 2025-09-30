require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const mongoose = require('mongoose');

// Import database module
const { 
  connectToDatabase, 
  loadDataFromDatabase, 
  saveDataToDatabase, 
  generateMultilingualTranslations,
  MenuItem,
  Category,
  Order,
  Client
} = require('./database');

const PORT = process.env.PORT || 4000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const KITCHEN_USER = process.env.KITCHEN_USER || 'kitchen';
const KITCHEN_PASS = process.env.KITCHEN_PASS || 'kitchen123';

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aroma-restaurant';

// Database models are now imported from database.js

// Database connection is now handled by database.js module

// Migrate data from files to MongoDB
async function migrateDataFromFiles() {
  try {
    console.log('🔄 Checking for existing file data to migrate...');
    
    // Check if we have file data to migrate
    const hasFileData = fs.existsSync(MENU_DATA_FILE) || fs.existsSync(ORDERS_DATA_FILE);
    if (!hasFileData) {
      console.log('📝 No file data found to migrate');
      return;
    }
    
    // Check if MongoDB already has data
    const existingItems = await MenuItem.countDocuments();
    const existingCategories = await Category.countDocuments();
    const existingOrders = await Order.countDocuments();
    
    if (existingItems > 0 || existingCategories > 0 || existingOrders > 0) {
      console.log('📊 MongoDB already has data, skipping migration');
      return;
    }
    
    console.log('🔄 Migrating data from files to MongoDB...');
    
    // Migrate menu data
    if (fs.existsSync(MENU_DATA_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(MENU_DATA_FILE, 'utf8'));
      
      if (fileData.categories && fileData.categories.length > 0) {
        await Category.insertMany(fileData.categories);
        console.log(`✅ Migrated ${fileData.categories.length} categories to MongoDB`);
      }
      
      if (fileData.items && fileData.items.length > 0) {
        await MenuItem.insertMany(fileData.items);
        console.log(`✅ Migrated ${fileData.items.length} menu items to MongoDB`);
      }
    }
    
    // Migrate orders data
    if (fs.existsSync(ORDERS_DATA_FILE)) {
      const ordersData = JSON.parse(fs.readFileSync(ORDERS_DATA_FILE, 'utf8'));
      if (ordersData && ordersData.length > 0) {
        await Order.insertMany(ordersData);
        console.log(`✅ Migrated ${ordersData.length} orders to MongoDB`);
      }
    }
    
    console.log('✅ Data migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error migrating data:', error);
  }
}

// Fix existing data schema issues
async function fixDataSchema() {
  try {
    console.log('🔄 Checking for data schema issues...');
    
    // Fix menu items that have 'category' instead of 'category_id'
    const itemsWithCategoryField = await MenuItem.find({ category: { $exists: true }, category_id: { $exists: false } });
    console.log('📊 Found items with old category field:', itemsWithCategoryField.length);
    
    if (itemsWithCategoryField.length > 0) {
      console.log('🔄 Fixing category field to category_id...');
      
      for (const item of itemsWithCategoryField) {
        try {
          console.log('🔍 Processing item:', item.id, 'category field:', item.category, 'type:', typeof item.category);
          
          // Map category names to category IDs
          const categoryMapping = {
            'Burgers': 1,
            'Sides': 2,
            'Drinks': 3,
            'Desserts': 4,
            'Pizza': 5,
            'Salads': 6
          };
          
          let categoryName = 'Burgers'; // Default fallback
          
          if (typeof item.category === 'string') {
            categoryName = item.category;
          } else if (item.category && typeof item.category === 'object') {
            categoryName = item.category.en || item.category.name || 'Burgers';
          } else if (item.category) {
            categoryName = String(item.category);
          }
          
          console.log('🔍 Determined category name:', categoryName);
          const categoryId = categoryMapping[categoryName] || 1; // Default to Burgers if not found
          
          await MenuItem.findByIdAndUpdate(item._id, {
            $set: { category_id: categoryId },
            $unset: { category: 1 }
          });
          
          console.log(`✅ Fixed item ${item.id}: ${categoryName} -> category_id: ${categoryId}`);
        } catch (itemError) {
          console.error(`❌ Error processing item ${item.id}:`, itemError.message);
          // Continue with next item
        }
      }
      
      console.log('✅ Data schema fixes completed');
    }
    
    // Fix categories that have string names instead of multilingual objects
    const categoriesWithStringNames = await Category.find({ 
      name: { $type: 'string' },
      'name.en': { $exists: false }
    });
    
    if (categoriesWithStringNames.length > 0) {
      console.log('🔄 Fixing category names to multilingual format...');
      
      for (const category of categoriesWithStringNames) {
        const categoryName = category.name;
        const multilingualName = generateMultilingualTranslations(categoryName, 'category');
        
        await Category.findByIdAndUpdate(category._id, {
          $set: { name: multilingualName }
        });
        
        console.log(`✅ Fixed category ${category.id}: ${categoryName} -> multilingual`);
      }
    }
    
    // Also fix any categories that might have inconsistent data types
    const allCategories = await Category.find({});
    console.log('🔍 Checking all categories for data consistency...');
    
    for (const category of allCategories) {
      if (typeof category.name === 'string') {
        console.log(`🔄 Converting category ${category.id} from string to multilingual: ${category.name}`);
        const multilingualName = generateMultilingualTranslations(category.name, 'category');
        
        await Category.findByIdAndUpdate(category._id, {
          $set: { name: multilingualName }
        });
        
        console.log(`✅ Fixed category ${category.id}: ${category.name} -> multilingual`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error fixing data schema:', error);
  }
}

// Initialize default data
async function initializeDefaultData() {
  try {
    // Check if categories exist
    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
      const defaultCategories = [
        { id: 1, name: 'Burgers', icon: '🍔', sort_order: 1, active: true },
        { id: 2, name: 'Sides', icon: '🍟', sort_order: 2, active: true },
        { id: 3, name: 'Drinks', icon: '🥤', sort_order: 3, active: true },
        { id: 4, name: 'Desserts', icon: '🍰', sort_order: 4, active: true }
      ];
      await Category.insertMany(defaultCategories);
      console.log('✅ Default categories created');
    }

    // Check if menu items exist
    const itemCount = await MenuItem.countDocuments();
    if (itemCount === 0) {
      const defaultItems = [
        {
          id: 1,
          name: { en: 'Classic Burger', mt: 'Burger Klassiku', it: 'Burger Classico', fr: 'Burger Classique', es: 'Burger Clásico', de: 'Klassischer Burger', ru: 'Классический бургер', pt: 'Burger Clássico', nl: 'Klassieke Burger', pl: 'Klasyczny Burger' },
          description: { en: 'Juicy beef patty with lettuce, tomato, and our special sauce', mt: 'Patty tal-baħar b\'lettuce, tadam u salsa speċjali tagħna', it: 'Polpetta di manzo succosa con lattuga, pomodoro e la nostra salsa speciale', fr: 'Steak de bœuf juteux avec laitue, tomate et notre sauce spéciale', es: 'Hamburguesa de carne jugosa con lechuga, tomate y nuestra salsa especial', de: 'Saftiges Rindersteak mit Salat, Tomate und unserer speziellen Sauce', ru: 'Сочная говяжья котлета с салатом, помидорами и нашим специальным соусом', pt: 'Hambúrguer de carne suculento com alface, tomate e nosso molho especial', nl: 'Sappige rundvleesburger met sla, tomaat en onze speciale saus', pl: 'Soczysty burger wołowy z sałatą, pomidorem i naszym specjalnym sosem' },
          price: 12.99,
          category: 'Burgers',
          image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500',
          active: true,
          prepTime: { en: '15 min', mt: '15 min', it: '15 min', fr: '15 min', es: '15 min', de: '15 Min', ru: '15 мин', pt: '15 min', nl: '15 min', pl: '15 min' }
        }
      ];
      await MenuItem.insertMany(defaultItems);
      console.log('✅ Default menu items created');
    }
  } catch (error) {
    console.error('❌ Error initializing default data:', error);
  }
}

// Email configuration
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@aromarestaurant.com';
const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'AROMA Restaurant';

// Configure SendGrid
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// In-memory data storage
let menuData = {
  categories: [
    { id: 1, name: 'Burgers', icon: '🍔', sort_order: 1, active: true },
    { id: 2, name: 'Sides', icon: '🍟', sort_order: 2, active: true },
    { id: 3, name: 'Drinks', icon: '🥤', sort_order: 3, active: true },
    { id: 4, name: 'Desserts', icon: '🍰', sort_order: 4, active: true }
  ],
  items: [
    {
      id: 1,
      name: { en: 'Classic Burger', mt: 'Burger Klassiku', it: 'Burger Classico', fr: 'Burger Classique', es: 'Burger Clásico', de: 'Klassischer Burger', ru: 'Классический бургер', pt: 'Burger Clássico', nl: 'Klassieke Burger', pl: 'Klasyczny Burger' },
      description: { en: 'Juicy beef patty with fresh lettuce and tomato', mt: 'Patty tal-baħar b\'lettuce friska u tadam', it: 'Polpetta di manzo succosa con lattuga fresca e pomodoro', fr: 'Steak de bœuf juteux avec laitue fraîche et tomate', es: 'Hamburguesa de carne jugosa con lechuga fresca y tomate', de: 'Saftiges Rindersteak mit frischem Salat und Tomate', ru: 'Сочная говяжья котлета со свежим салатом и помидорами', pt: 'Hambúrguer de carne suculento com alface fresca e tomate', nl: 'Sappige rundvleesburger met verse sla en tomaat', pl: 'Soczysta wołowina z świeżą sałatą i pomidorem' },
      price: 12.99,
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
      video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      category_id: 1,
      active: true,
      ingredients: { en: 'Beef patty, lettuce, tomato, onion, bun', mt: 'Patty tal-baħar, lettuce, tadam, basal, bun', it: 'Polpetta di manzo, lattuga, pomodoro, cipolla, panino', fr: 'Steak de bœuf, laitue, tomate, oignon, pain', es: 'Hamburguesa de carne, lechuga, tomate, cebolla, pan', de: 'Rindersteak, Salat, Tomate, Zwiebel, Brötchen', ru: 'Говяжья котлета, салат, помидор, лук, булочка', pt: 'Hambúrguer de carne, alface, tomate, cebola, pão', nl: 'Rundvleesburger, sla, tomaat, ui, broodje', pl: 'Wołowina, sałata, pomidor, cebula, bułka' },
      nutrition: { en: 'Calories: 650, Protein: 35g, Carbs: 45g, Fat: 35g', mt: 'Kaloriji: 650, Proteini: 35g, Karboidrati: 45g, Xaħmijiet: 35g', it: 'Calorie: 650, Proteine: 35g, Carboidrati: 45g, Grassi: 35g', fr: 'Calories: 650, Protéines: 35g, Glucides: 45g, Lipides: 35g', es: 'Calorías: 650, Proteínas: 35g, Carbohidratos: 45g, Grasas: 35g', de: 'Kalorien: 650, Eiweiß: 35g, Kohlenhydrate: 45g, Fette: 35g', ru: 'Калории: 650, Белки: 35г, Углеводы: 45г, Жиры: 35г', pt: 'Calorias: 650, Proteínas: 35g, Carboidratos: 45g, Gorduras: 35g', nl: 'Calorieën: 650, Eiwit: 35g, Koolhydraten: 45g, Vet: 35g', pl: 'Kalorie: 650, Białko: 35g, Węglowodany: 45g, Tłuszcz: 35g' },
      allergies: { en: 'Contains gluten, dairy', mt: 'Fih gluten, dairy', it: 'Contiene glutine, latticini', fr: 'Contient du gluten, des produits laitiers', es: 'Contiene gluten, lácteos', de: 'Enthält Gluten, Milchprodukte', ru: 'Содержит глютен, молочные продукты', pt: 'Contém glúten, laticínios', nl: 'Bevat gluten, zuivel', pl: 'Zawiera gluten, nabiał' },
      prepTime: { en: '15 min', mt: '15 min', it: '15 min', fr: '15 min', es: '15 min', de: '15 Min', ru: '15 мин', pt: '15 min', nl: '15 min', pl: '15 min' }
    },
    {
      id: 2,
      name: { en: 'Cheese Burger', mt: 'Burger bil-Ġobon', it: 'Burger con Formaggio', fr: 'Burger au Fromage', es: 'Burger con Queso', de: 'Käseburger', ru: 'Чизбургер', pt: 'Burger com Queijo', nl: 'Kaasburger', pl: 'Burger z Serem' },
      description: { en: 'Classic burger with melted cheese', mt: 'Burger klassiku b\'ġobon imdawwar', it: 'Burger classico con formaggio fuso', fr: 'Burger classique avec fromage fondu', es: 'Burger clásico con queso derretido', de: 'Klassischer Burger mit geschmolzenem Käse', ru: 'Классический бургер с расплавленным сыром', pt: 'Burger clássico com queijo derretido', nl: 'Klassieke burger met gesmolten kaas', pl: 'Klasyczny burger z roztopionym serem' },
      price: 14.99,
      image: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=400',
      category_id: 1,
      active: true,
      ingredients: { en: 'Beef patty, cheese, lettuce, tomato, onion, bun', mt: 'Patty tal-baħar, ġobon, lettuce, tadam, basal, bun', it: 'Polpetta di manzo, formaggio, lattuga, pomodoro, cipolla, panino', fr: 'Steak de bœuf, fromage, laitue, tomate, oignon, pain', es: 'Hamburguesa de carne, queso, lechuga, tomate, cebolla, pan', de: 'Rindersteak, Käse, Salat, Tomate, Zwiebel, Brötchen', ru: 'Говяжья котлета, сыр, салат, помидор, лук, булочка', pt: 'Hambúrguer de carne, queijo, alface, tomate, cebola, pão', nl: 'Rundvleesburger, kaas, sla, tomaat, ui, broodje', pl: 'Wołowina, ser, sałata, pomidor, cebula, bułka' },
      nutrition: { en: 'Calories: 720, Protein: 38g, Carbs: 48g, Fat: 42g', mt: 'Kaloriji: 720, Proteini: 38g, Karboidrati: 48g, Xaħmijiet: 42g', it: 'Calorie: 720, Proteine: 38g, Carboidrati: 48g, Grassi: 42g', fr: 'Calories: 720, Protéines: 38g, Glucides: 48g, Lipides: 42g', es: 'Calorías: 720, Proteínas: 38g, Carbohidratos: 48g, Grasas: 42g', de: 'Kalorien: 720, Eiweiß: 38g, Kohlenhydrate: 48g, Fette: 42g', ru: 'Калории: 720, Белки: 38г, Углеводы: 48г, Жиры: 42г', pt: 'Calorias: 720, Proteínas: 38g, Carboidratos: 48g, Gorduras: 42g', nl: 'Calorieën: 720, Eiwit: 38g, Koolhydraten: 48g, Vet: 42g', pl: 'Kalorie: 720, Białko: 38g, Węglowodany: 48g, Tłuszcz: 42g' },
      allergies: { en: 'Contains gluten, dairy', mt: 'Fih gluten, dairy', it: 'Contiene glutine, latticini', fr: 'Contient du gluten, des produits laitiers', es: 'Contiene gluten, lácteos', de: 'Enthält Gluten, Milchprodukte', ru: 'Содержит глютен, молочные продукты', pt: 'Contém glúten, laticínios', nl: 'Bevat gluten, zuivel', pl: 'Zawiera gluten, nabiał' },
      prepTime: { en: '18 min', mt: '18 min', it: '18 min', fr: '18 min', es: '18 min', de: '18 Min', ru: '18 мин', pt: '18 min', nl: '18 min', pl: '18 min' }
    },
    {
      id: 3,
      name: { en: 'French Fries', mt: 'Patata Fritti', it: 'Patatine Fritte', fr: 'Frites', es: 'Papas Fritas', de: 'Pommes Frites', ru: 'Картофель фри', pt: 'Batatas Fritas', nl: 'Frietjes', pl: 'Frytki' },
      description: { en: 'Crispy golden french fries', mt: 'Patata fritti tal-deheb ċrispi', it: 'Patatine fritte dorate e croccanti', fr: 'Frites dorées et croustillantes', es: 'Papas fritas doradas y crujientes', de: 'Knusprige goldene Pommes Frites', ru: 'Хрустящий золотистый картофель фри', pt: 'Batatas fritas douradas e crocantes', nl: 'Knapperige gouden frietjes', pl: 'Chrupiące złote frytki' },
      price: 4.99,
      image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400',
      category_id: 2,
      active: true,
      ingredients: { en: 'Potatoes, salt, oil', mt: 'Patata, melħ, żejt', it: 'Patate, sale, olio', fr: 'Pommes de terre, sel, huile', es: 'Patatas, sal, aceite', de: 'Kartoffeln, Salz, Öl', ru: 'Картофель, соль, масло', pt: 'Batatas, sal, óleo', nl: 'Aardappelen, zout, olie', pl: 'Ziemniaki, sól, olej' },
      nutrition: { en: 'Calories: 320, Protein: 4g, Carbs: 38g, Fat: 18g', mt: 'Kaloriji: 320, Proteini: 4g, Karboidrati: 38g, Xaħmijiet: 18g', it: 'Calorie: 320, Proteine: 4g, Carboidrati: 38g, Grassi: 18g', fr: 'Calories: 320, Protéines: 4g, Glucides: 38g, Lipides: 18g', es: 'Calorías: 320, Proteínas: 4g, Carbohidratos: 38g, Grasas: 18g', de: 'Kalorien: 320, Eiweiß: 4g, Kohlenhydrate: 38g, Fette: 18g', ru: 'Калории: 320, Белки: 4г, Углеводы: 38г, Жиры: 18г', pt: 'Calorias: 320, Proteínas: 4g, Carboidratos: 38g, Gorduras: 18g', nl: 'Calorieën: 320, Eiwit: 4g, Koolhydraten: 38g, Vet: 18g', pl: 'Kalorie: 320, Białko: 4g, Węglowodany: 38g, Tłuszcz: 18g' },
      allergies: { en: 'Contains gluten', mt: 'Fih gluten', it: 'Contiene glutine', fr: 'Contient du gluten', es: 'Contiene gluten', de: 'Enthält Gluten', ru: 'Содержит глютен', pt: 'Contém glúten', nl: 'Bevat gluten', pl: 'Zawiera gluten' },
      prepTime: { en: '8 min', mt: '8 min', it: '8 min', fr: '8 min', es: '8 min', de: '8 Min', ru: '8 мин', pt: '8 min', nl: '8 min', pl: '8 min' }
    },
    {
      id: 4,
      name: { en: 'Coca Cola', mt: 'Coca Cola', it: 'Coca Cola', fr: 'Coca Cola', es: 'Coca Cola', de: 'Coca Cola', ru: 'Кока-Кола', pt: 'Coca Cola', nl: 'Coca Cola', pl: 'Coca Cola' },
      description: { en: 'Refreshing cola drink', mt: 'Xarba tal-kola rinfrexxanti', it: 'Bibita rinfrescante alla cola', fr: 'Boisson rafraîchissante au cola', es: 'Bebida refrescante de cola', de: 'Erfrischendes Cola-Getränk', ru: 'Освежающий напиток кола', pt: 'Bebida refrescante de cola', nl: 'Verfrissend coladrankje', pl: 'Orzeźwiający napój cola' },
      price: 2.99,
      image: 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=400',
      category_id: 3,
      active: true,
      ingredients: { en: 'Water, sugar, caramel color, phosphoric acid, natural flavors, caffeine', mt: 'Ilma, zokkor, kulur tal-karamella, aċidu fosforiku, togħmiet naturali, kaffeina', it: 'Acqua, zucchero, colore caramello, acido fosforico, aromi naturali, caffeina', fr: 'Eau, sucre, couleur caramel, acide phosphorique, arômes naturels, caféine', es: 'Agua, azúcar, color caramelo, ácido fosfórico, sabores naturales, cafeína', de: 'Wasser, Zucker, Karamellfarbe, Phosphorsäure, natürliche Aromen, Koffein', ru: 'Вода, сахар, карамельный краситель, фосфорная кислота, натуральные ароматизаторы, кофеин', pt: 'Água, açúcar, cor caramelo, ácido fosfórico, sabores naturais, cafeína', nl: 'Water, suiker, karamelkleur, fosforzuur, natuurlijke smaken, cafeïne', pl: 'Woda, cukier, kolor karmelowy, kwas fosforowy, naturalne aromaty, kofeina' },
      nutrition: { en: 'Calories: 140, Protein: 0g, Carbs: 39g, Fat: 0g', mt: 'Kaloriji: 140, Proteini: 0g, Karboidrati: 39g, Xaħmijiet: 0g', it: 'Calorie: 140, Proteine: 0g, Carboidrati: 39g, Grassi: 0g', fr: 'Calories: 140, Protéines: 0g, Glucides: 39g, Lipides: 0g', es: 'Calorías: 140, Proteínas: 0g, Carbohidratos: 39g, Grasas: 0g', de: 'Kalorien: 140, Eiweiß: 0g, Kohlenhydrate: 39g, Fette: 0g', ru: 'Калории: 140, Белки: 0г, Углеводы: 39г, Жиры: 0г', pt: 'Calorias: 140, Proteínas: 0g, Carboidratos: 39g, Gorduras: 0g', nl: 'Calorieën: 140, Eiwit: 0g, Koolhydraten: 39g, Vet: 0g', pl: 'Kalorie: 140, Białko: 0g, Węglowodany: 39g, Tłuszcz: 0g' },
      allergies: { en: 'Contains caffeine', mt: 'Fih kaffeina', it: 'Contiene caffeina', fr: 'Contient de la caféine', es: 'Contiene cafeína', de: 'Enthält Koffein', ru: 'Содержит кофеин', pt: 'Contém cafeína', nl: 'Bevat cafeïne', pl: 'Zawiera kofeinę' },
      prepTime: { en: '1 min', mt: '1 min', it: '1 min', fr: '1 min', es: '1 min', de: '1 Min', ru: '1 мин', pt: '1 min', nl: '1 min', pl: '1 min' }
    },
    {
      id: 5,
      name: { en: 'Chocolate Cake', mt: 'Kejk tal-Ċikkulata', it: 'Torta al Cioccolato', fr: 'Gâteau au Chocolat', es: 'Pastel de Chocolate', de: 'Schokoladenkuchen', ru: 'Шоколадный торт', pt: 'Bolo de Chocolate', nl: 'Chocoladetaart', pl: 'Ciasto Czekoladowe' },
      description: { en: 'Rich chocolate cake with cream', mt: 'Kejk rikk tal-ċikkulata b\'krema', it: 'Torta ricca al cioccolato con panna', fr: 'Gâteau riche au chocolat avec crème', es: 'Pastel rico de chocolate con crema', de: 'Reicher Schokoladenkuchen mit Sahne', ru: 'Богатый шоколадный торт со сливками', pt: 'Bolo rico de chocolate com creme', nl: 'Rijke chocoladetaart met room', pl: 'Bogate ciasto czekoladowe ze śmietaną' },
      price: 6.99,
      image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
      category_id: 4,
      active: true,
      ingredients: { en: 'Flour, sugar, eggs, butter, cocoa powder, cream', mt: 'Dqiq, zokkor, bajd, butir, trab tal-kakaw, krema', it: 'Farina, zucchero, uova, burro, cacao in polvere, panna', fr: 'Farine, sucre, œufs, beurre, cacao en poudre, crème', es: 'Harina, azúcar, huevos, mantequilla, cacao en polvo, crema', de: 'Mehl, Zucker, Eier, Butter, Kakaopulver, Sahne', ru: 'Мука, сахар, яйца, масло, какао-порошок, сливки', pt: 'Farinha, açúcar, ovos, manteiga, cacau em pó, creme', nl: 'Bloem, suiker, eieren, boter, cacaopoeder, room', pl: 'Mąka, cukier, jajka, masło, kakao w proszku, śmietana' },
      nutrition: { en: 'Calories: 450, Protein: 8g, Carbs: 52g, Fat: 24g', mt: 'Kaloriji: 450, Proteini: 8g, Karboidrati: 52g, Xaħmijiet: 24g', it: 'Calorie: 450, Proteine: 8g, Carboidrati: 52g, Grassi: 24g', fr: 'Calories: 450, Protéines: 8g, Glucides: 52g, Lipides: 24g', es: 'Calorías: 450, Proteínas: 8g, Carbohidratos: 52g, Grasas: 24g', de: 'Kalorien: 450, Eiweiß: 8g, Kohlenhydrate: 52g, Fette: 24g', ru: 'Калории: 450, Белки: 8г, Углеводы: 52г, Жиры: 24г', pt: 'Calorias: 450, Proteínas: 8g, Carboidratos: 52g, Gorduras: 24g', nl: 'Calorieën: 450, Eiwit: 8g, Koolhydraten: 52g, Vet: 24g', pl: 'Kalorie: 450, Białko: 8g, Węglowodany: 52g, Tłuszcz: 24g' },
      allergies: { en: 'Contains gluten, dairy, eggs', mt: 'Fih gluten, dairy, bajd', it: 'Contiene glutine, latticini, uova', fr: 'Contient du gluten, des produits laitiers, des œufs', es: 'Contiene gluten, lácteos, huevos', de: 'Enthält Gluten, Milchprodukte, Eier', ru: 'Содержит глютен, молочные продукты, яйца', pt: 'Contém glúten, laticínios, ovos', nl: 'Bevat gluten, zuivel, eieren', pl: 'Zawiera gluten, nabiał, jajka' },
      prepTime: { en: '25 min', mt: '25 min', it: '25 min', fr: '25 min', es: '25 min', de: '25 Min', ru: '25 мин', pt: '25 min', nl: '25 min', pl: '25 min' }
    }
  ]
};

let orders = [];
let clients = [];
let orderIdCounter = 1;

// Data persistence files - using multiple backup locations for reliability
const MENU_DATA_FILE = path.join(__dirname, 'data', 'menu-data.json');
const ORDERS_DATA_FILE = path.join(__dirname, 'data', 'orders-data.json');
const CLIENTS_DATA_FILE = path.join(__dirname, 'data', 'clients-data.json');
const MENU_DATA_BACKUP = path.join(__dirname, 'menu-data.json');
const ORDERS_DATA_BACKUP = path.join(__dirname, 'orders-data.json');
const CLIENTS_DATA_BACKUP = path.join(__dirname, 'clients-data.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('📁 Created data directory:', dataDir);
}

// Force create data directory and files on startup
function initializeDataFiles() {
  try {
    // Create data directory
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('📁 Created data directory:', dataDir);
    }
    
    // Create initial data files if they don't exist
    if (!fs.existsSync(MENU_DATA_FILE) && !fs.existsSync(MENU_DATA_BACKUP)) {
      console.log('📝 Creating initial menu data file...');
      saveMenuData();
    }
    
    // Only create orders data files if MongoDB is not configured
    if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('localhost')) {
      if (!fs.existsSync(ORDERS_DATA_FILE) && !fs.existsSync(ORDERS_DATA_BACKUP)) {
        console.log('📝 Creating initial orders data file...');
        saveOrdersData();
      }
    } else {
      console.log('📝 MongoDB configured, skipping orders data file creation');
    }
    
    console.log('✅ Data files initialized');
  } catch (error) {
    console.error('❌ Error initializing data files:', error);
  }
}

// Helper function to extract YouTube video ID
function getYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return '';
  
  try {
    // Handle regular YouTube URLs: https://www.youtube.com/watch?v=VIDEO_ID
    if (url.includes('youtube.com/watch?v=')) {
      const parts = url.split('v=');
      if (parts.length > 1) {
        return parts[1].split('&')[0];
      }
    }
    // Handle YouTube Shorts URLs: https://www.youtube.com/shorts/VIDEO_ID
    else if (url.includes('youtube.com/shorts/')) {
      const parts = url.split('youtube.com/shorts/');
      if (parts.length > 1) {
        return parts[1].split('?')[0];
      }
    }
    // Handle youtu.be URLs: https://youtu.be/VIDEO_ID
    else if (url.includes('youtu.be/')) {
      const parts = url.split('youtu.be/');
      if (parts.length > 1) {
        return parts[1].split('?')[0];
      }
    }
    
    return '';
  } catch (error) {
    console.error('Error extracting YouTube video ID:', error);
    return '';
  }
}

// Helper function to generate YouTube thumbnail URL
function generateYouTubeThumbnail(videoUrl) {
  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) return null;
  
  // Return high quality thumbnail URL
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

// generateMultilingualTranslations function is now imported from database.js

function saveMenuData() {
  try {
    const data = JSON.stringify(menuData, null, 2);
    
    // Ensure data directory exists before writing
    const dataDir = path.dirname(MENU_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('📁 Created data directory:', dataDir);
    }
    
    // Write to primary location with error handling
    try {
      fs.writeFileSync(MENU_DATA_FILE, data, 'utf8');
      console.log('✅ Menu data saved to primary location:', MENU_DATA_FILE);
    } catch (writeError) {
      console.error('❌ Failed to write to primary location:', writeError);
    }
    
    // Write to backup location with error handling
    try {
      fs.writeFileSync(MENU_DATA_BACKUP, data, 'utf8');
      console.log('✅ Menu data saved to backup location:', MENU_DATA_BACKUP);
    } catch (writeError) {
      console.error('❌ Failed to write to backup location:', writeError);
    }
    
    // Verify the files were written
    const primaryExists = fs.existsSync(MENU_DATA_FILE);
    const backupExists = fs.existsSync(MENU_DATA_BACKUP);
    const primarySize = primaryExists ? fs.statSync(MENU_DATA_FILE).size : 0;
    const backupSize = backupExists ? fs.statSync(MENU_DATA_BACKUP).size : 0;
    
    console.log('📁 File verification - Primary:', primaryExists, `(${primarySize} bytes)`, 'Backup:', backupExists, `(${backupSize} bytes)`);
    
    // Log items with video URLs
    const itemsWithVideo = menuData.items.filter(item => item.video && item.video.trim() !== '');
    if (itemsWithVideo.length > 0) {
      console.log('Items with video URLs:', itemsWithVideo.map(item => ({ id: item.id, name: item.name.en, video: item.video, thumbnail: item.thumbnail })));
    } else {
      console.log('No items with video URLs found');
    }
    
    return { success: true, primaryExists, backupExists };
  } catch (error) {
    console.error('❌ Error saving menu data:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    return { success: false, error: error.message };
  }
}

// Enhanced save function that saves to both MongoDB and files
async function saveMenuDataToMongoDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      // Save categories to MongoDB
      for (const category of menuData.categories) {
        await Category.findOneAndUpdate({ id: category.id }, category, { upsert: true });
      }
      
      // Save items to MongoDB
      for (const item of menuData.items) {
        await MenuItem.findOneAndUpdate({ id: item.id }, item, { upsert: true });
      }
      
      console.log('✅ Menu data saved to MongoDB Atlas');
    }
    
    // Always save to files as backup
    saveMenuData();
    
  } catch (error) {
    console.error('❌ Error saving menu data to MongoDB:', error);
    // Fallback to file storage
    saveMenuData();
  }
}

async function loadMenuData() {
  try {
    console.log('🔄 Loading menu data...');
    console.log('MongoDB connection state:', mongoose.connection.readyState);
    
    // First try to load from MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        console.log('🔄 Loading menu data from MongoDB Atlas...');
        
        const mongoCategories = await Category.find().sort({ sort_order: 1 });
        const mongoItems = await MenuItem.find().sort({ id: 1 });
        
        console.log('📊 Found categories in MongoDB:', mongoCategories.length);
        console.log('📊 Found items in MongoDB:', mongoItems.length);
        
        // Convert to plain objects and ensure proper data types
        menuData.categories = mongoCategories.map(cat => {
          const obj = cat.toObject();
          // Ensure category names are properly formatted
          if (typeof obj.name === 'object' && obj.name.en) {
            // Already multilingual, keep as is
          } else if (typeof obj.name === 'string') {
            // Convert string to multilingual
            obj.name = generateMultilingualTranslations(obj.name, 'category');
          }
          return obj;
        });
        
        menuData.items = mongoItems.map(item => {
          const obj = item.toObject();
          // Ensure item names are properly formatted
          if (typeof obj.name === 'object' && obj.name.en) {
            // Already multilingual, keep as is
          } else if (typeof obj.name === 'string') {
            // Convert string to multilingual
            obj.name = generateMultilingualTranslations(obj.name, 'item');
          }
          return obj;
        });
        
        console.log('✅ Menu data loaded from MongoDB Atlas - Categories:', menuData.categories.length, 'Items:', menuData.items.length);
        return;
      } catch (error) {
        console.error('❌ Error loading menu data from MongoDB:', error);
        console.log('🔄 Falling back to file-based storage...');
      }
    } else {
      console.log('🔄 MongoDB not connected (state:', mongoose.connection.readyState, '), using file-based storage');
    }
    
    // Fallback to file-based storage
    let dataFile = null;
    if (fs.existsSync(MENU_DATA_FILE)) {
      dataFile = MENU_DATA_FILE;
    } else if (fs.existsSync(MENU_DATA_BACKUP)) {
      dataFile = MENU_DATA_BACKUP;
      console.log('📁 Loading menu data from backup location');
    }
    
    if (dataFile) {
      const data = fs.readFileSync(dataFile, 'utf8');
      const loadedData = JSON.parse(data);
      // Only use defaults if loaded data is empty or missing
      if (loadedData.categories && loadedData.categories.length > 0) {
        menuData.categories = loadedData.categories;
      }
      if (loadedData.items && loadedData.items.length > 0) {
        menuData.items = loadedData.items;
      }
      console.log('✅ Menu data loaded from file - Categories:', menuData.categories.length, 'Items:', menuData.items.length);
    } else {
      console.log('📝 No existing menu data file, using defaults');
      saveMenuData(); // Save initial data
    }
  } catch (error) {
    console.error('❌ Error loading menu data:', error);
  }
}

// Helper function to format menu data for consistency
function formatMenuData() {
  try {
    console.log('🔄 Formatting menu data for consistency...');
    
    // Fix categories - ensure names are multilingual objects
    if (menuData.categories) {
      menuData.categories = menuData.categories.map(category => {
        if (typeof category.name === 'string') {
          console.log(`🔄 Converting category "${category.name}" to multilingual format`);
          return {
            ...category,
            name: generateMultilingualTranslations(category.name, 'category')
          };
        }
        return category;
      });
    }
    
    // Fix items - ensure names are multilingual objects
    if (menuData.items) {
      menuData.items = menuData.items.map(item => {
        if (typeof item.name === 'string') {
          console.log(`🔄 Converting item "${item.name}" to multilingual format`);
          return {
            ...item,
            name: generateMultilingualTranslations(item.name, 'item')
          };
        }
        return item;
      });
    }
    
    console.log('✅ Menu data formatted successfully');
  } catch (error) {
    console.error('❌ Error formatting menu data:', error);
  }
}

function saveOrdersData() {
  try {
    const ordersData = {
      orders: orders,
      orderIdCounter: orderIdCounter
    };
    const data = JSON.stringify(ordersData, null, 2);
    
    // Ensure data directory exists before writing
    const dataDir = path.dirname(ORDERS_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('📁 Created data directory:', dataDir);
    }
    
    // Write to primary location
    fs.writeFileSync(ORDERS_DATA_FILE, data);
    console.log('✅ Orders data saved to primary location:', ORDERS_DATA_FILE);
    
    // Write to backup location
    fs.writeFileSync(ORDERS_DATA_BACKUP, data);
    console.log('✅ Orders data saved to backup location:', ORDERS_DATA_BACKUP);
    
    // Verify the files were written
    const primaryExists = fs.existsSync(ORDERS_DATA_FILE);
    const backupExists = fs.existsSync(ORDERS_DATA_BACKUP);
    console.log('📁 File verification - Primary:', primaryExists, 'Backup:', backupExists);
    console.log('📊 Orders saved:', orders.length, 'orders, next ID:', orderIdCounter);
  } catch (error) {
    console.error('❌ Error saving orders data:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

async function loadOrdersData() {
  try {
    console.log('🔄 Loading orders data...');
    console.log('MongoDB connection state:', mongoose.connection.readyState);
    
    // First try to load from MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        console.log('🔄 Attempting to load orders from MongoDB Atlas...');
        const mongoOrders = await Order.find().sort({ createdAt: -1 });
        console.log('📊 Found orders in MongoDB:', mongoOrders.length);
        
        // Always use MongoDB when connected, even if empty
        orders = mongoOrders.map(order => {
          const orderObj = order.toObject();
          // Ensure _id is preserved for MongoDB operations
          orderObj._id = order._id;
          return orderObj;
        });
        orderIdCounter = mongoOrders.length > 0 ? Math.max(...orders.map(o => o.id), 0) + 1 : 1;
        console.log('✅ Orders data loaded from MongoDB Atlas:', orders.length, 'orders');
        console.log('📊 Sample orders:', orders.slice(0, 2));
        console.log('🔢 Next order ID will be:', orderIdCounter);
        return;
      } catch (error) {
        console.error('❌ Error loading orders from MongoDB:', error);
        console.log('🔄 Falling back to file-based storage...');
      }
    } else {
      console.log('🔄 MongoDB not connected, using file-based storage');
    }
    
    // Fallback to file-based storage
    let dataFile = null;
    if (fs.existsSync(ORDERS_DATA_FILE)) {
      dataFile = ORDERS_DATA_FILE;
    } else if (fs.existsSync(ORDERS_DATA_BACKUP)) {
      dataFile = ORDERS_DATA_BACKUP;
      console.log('📁 Loading orders data from backup location');
    }
    
    if (dataFile) {
      const data = fs.readFileSync(dataFile, 'utf8');
      const loadedData = JSON.parse(data);
      orders = loadedData.orders || [];
      orderIdCounter = loadedData.orderIdCounter || 1;
      console.log('✅ Orders data loaded from file:', orders.length, 'orders');
      console.log('📊 Sample orders:', orders.slice(0, 2));
      console.log('🔢 Next order ID will be:', orderIdCounter);
    } else {
      console.log('📝 No existing orders data file, starting fresh');
      orders = [];
      orderIdCounter = 1;
    }
  } catch (error) {
    console.error('❌ Error loading orders data:', error);
    orders = [];
    orderIdCounter = 1;
  }
}

// Initialize data files and load data on startup
initializeDataFiles();
// Note: loadMenuData() and loadOrdersData() are called after MongoDB connection in app.listen()

const app = express();

// Email sending function using SendGrid
async function sendOrderConfirmation(order, customerEmail, customerName) {
  try {
    console.log('📧 SendGrid API Key configured:', !!SENDGRID_API_KEY);
    console.log('📧 API Key length:', SENDGRID_API_KEY ? SENDGRID_API_KEY.length : 0);
    
    if (!SENDGRID_API_KEY) {
      console.log('⚠️ SendGrid API key not configured - skipping email send');
      return { success: false, message: 'SendGrid API key not configured' };
    }

    const orderItems = order.items.map(item => {
      const menuItem = menuData.items.find(mi => mi.id === item.id);
      return {
        name: menuItem ? menuItem.name.en : `Item ${item.id}`,
        quantity: item.qty,
        price: menuItem ? menuItem.price : 0
      };
    });

    const orderTotal = orderItems.reduce((total, item) => total + (item.price * item.quantity), 0);

    const msg = {
      to: customerEmail,
      from: EMAIL_FROM,
      subject: `Order Confirmation - ${RESTAURANT_NAME}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">🍔 ${RESTAURANT_NAME}</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Order Confirmation</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #333; margin-top: 0;">Hello ${customerName}!</h2>
            <p style="color: #666; font-size: 16px;">Thank you for your order! Here are the details:</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #333; margin-top: 0;">Order #${order.id}</h3>
              <p style="margin: 5px 0;"><strong>Order Type:</strong> ${order.orderType === 'dine-in' ? 'Dine In' : 'Takeaway'}</p>
              ${order.tableNumber ? `<p style="margin: 5px 0;"><strong>Table:</strong> ${order.tableNumber}</p>` : ''}
              <p style="margin: 5px 0;"><strong>Order Time:</strong> ${new Date(order.timestamp).toLocaleString()}</p>
              ${order.marketingConsent ? `<p style="margin: 5px 0; color: #28a745;"><strong>✓ Marketing Communications:</strong> Opted In</p>` : '<p style="margin: 5px 0; color: #dc3545;"><strong>✗ Marketing Communications:</strong> Opted Out</p>'}
            </div>
            
            <h3 style="color: #333;">Your Order:</h3>
            <div style="border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
              ${orderItems.map(item => `
                <div style="display: flex; justify-content: space-between; padding: 15px; border-bottom: 1px solid #f0f0f0;">
                  <div>
                    <strong>${item.name}</strong>
                    <div style="color: #666; font-size: 14px;">Quantity: ${item.quantity}</div>
                  </div>
                  <div style="font-weight: bold; color: #ff6b35;">€${(item.price * item.quantity).toFixed(2)}</div>
                </div>
              `).join('')}
              <div style="display: flex; justify-content: space-between; padding: 15px; background: #f8f9fa; font-weight: bold; font-size: 18px;">
                <span>Total:</span>
                <span style="color: #ff6b35;">€${orderTotal.toFixed(2)}</span>
              </div>
            </div>
            
            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #2d5a2d;"><strong>Status:</strong> ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</p>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              We'll prepare your order and notify you when it's ready. Thank you for choosing ${RESTAURANT_NAME}!
            </p>
          </div>
          
          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 14px;">
            <p style="margin: 0;">© 2024 ${RESTAURANT_NAME}. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const result = await sgMail.send(msg);
    console.log('✅ Email sent successfully via SendGrid:', result[0].statusCode);
    return { success: true, messageId: result[0].headers['x-message-id'] };
  } catch (error) {
    console.error('❌ SendGrid email sending failed:', error);
    return { success: false, error: error.message };
  }
}

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Add translation helper to EJS
app.locals.translate = function(text, language = 'en') {
  if (!text) return '';
  
  // If it's already a string, return as is
  if (typeof text === 'string') {
    return text;
  }
  
  // If it's an object with language keys, return the requested language or fallback to English
  if (typeof text === 'object' && text !== null) {
    return text[language] || text.en || text.toString();
  }
  
  // Fallback to string conversion
  return text.toString();
};

// Enhanced CORS configuration - Allow all origins for now
app.use(cors({ 
  origin: true, // Allow all origins temporarily
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control']
}));

// Manual CORS headers as backup - Allow all origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the frontend build
app.use(express.static(path.join(__dirname, '../AROMA_FRONTEND/dist')));

// Basic auth for admin routes
const authMiddleware = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'Admin Area'
});

// Basic auth for kitchen staff routes
const kitchenAuthMiddleware = basicAuth({
  users: { [KITCHEN_USER]: KITCHEN_PASS },
  challenge: true,
  realm: 'Kitchen Staff Area'
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../AROMA_FRONTEND/dist/index.html'));
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    message: 'CORS is working!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for menu data structure
app.get('/api/test-menu-data', (req, res) => {
  try {
    res.json({
      success: true,
      menuData: {
        itemsCount: menuData.items ? menuData.items.length : 0,
        categoriesCount: menuData.categories ? menuData.categories.length : 0,
        sampleItem: menuData.items && menuData.items.length > 0 ? menuData.items[0] : null,
        sampleCategory: menuData.categories && menuData.categories.length > 0 ? menuData.categories[0] : null
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Test endpoint error', details: error.message });
  }
});

// Debug endpoint to test menu data
app.get('/api/debug', async (req, res) => {
  try {
    let mongoCategories = [];
    let mongoItems = [];
    let mongoOrders = [];
    
    if (mongoose.connection.readyState === 1) {
      try {
        mongoCategories = await Category.find();
        mongoItems = await MenuItem.find();
        mongoOrders = await Order.find();
      } catch (error) {
        console.error('Error fetching from MongoDB:', error);
      }
    }
    
  res.json({
      message: 'Backend is working!',
      categories: menuData.categories.length,
      items: menuData.items.length,
      orders: orders.length,
      orderIdCounter: orderIdCounter,
      timestamp: new Date().toISOString(),
      sampleItem: menuData.items[0] || 'No items',
      sampleOrder: orders[0] || 'No orders',
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState,
        categoriesInMongo: mongoCategories.length,
        itemsInMongo: mongoItems.length,
        ordersInMongo: mongoOrders.length,
        sampleMongoCategory: mongoCategories[0] || 'No categories in MongoDB',
        sampleMongoItem: mongoItems[0] || 'No items in MongoDB'
      },
      dataFiles: {
        menuDataExists: fs.existsSync(MENU_DATA_FILE),
        ordersDataExists: fs.existsSync(ORDERS_DATA_FILE),
        menuDataBackupExists: fs.existsSync(MENU_DATA_BACKUP),
        ordersDataBackupExists: fs.existsSync(ORDERS_DATA_BACKUP),
        menuDataPath: MENU_DATA_FILE,
        ordersDataPath: ORDERS_DATA_FILE,
        menuDataBackupPath: MENU_DATA_BACKUP,
        ordersDataBackupPath: ORDERS_DATA_BACKUP
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Debug endpoint error', details: error.message });
  }
});

// Manual save endpoint for testing
app.post('/api/save-data', (req, res) => {
  try {
    saveMenuData();
    saveOrdersData();
    res.json({
      success: true,
      message: 'Data saved successfully',
      ordersCount: orders.length,
      menuItemsCount: menuData.items.length,
      categoriesCount: menuData.categories.length
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Test email endpoint
app.get('/api/test-email', async (req, res) => {
  try {
    const testOrder = {
      id: 999,
      items: [{ id: 1, name: { en: 'Test Burger' }, price: 12.99, qty: 1 }],
      orderType: 'dine-in',
      tableNumber: 5,
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      total: 12.99,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    const emailResult = await sendOrderConfirmation(testOrder, 'test@example.com', 'Test Customer');
    
    res.json({
      success: true,
      emailResult: emailResult,
      emailConfigured: !!SENDGRID_API_KEY,
      sendGridApiKey: SENDGRID_API_KEY ? 'Set' : 'Not Set'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      emailConfigured: !!SENDGRID_API_KEY
    });
  }
});

// API Routes
app.get('/api/menu', (req, res) => {
  try {
    res.json(menuData);
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ error: 'Failed to fetch menu data' });
  }
});

app.get('/api/menu/items', (req, res) => {
  try {
    res.json(menuData.items || []);
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

app.get('/api/menu/categories', (req, res) => {
  try {
    res.json(menuData.categories || []);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Menu Management API Routes
app.post('/api/menu/items', async (req, res) => {
  try {
    const { name, description, price, image, category_id, ingredients, nutrition, allergies, prepTime, video } = req.body;
    console.log('POST /api/menu/items - Received data:', { name, video, image, category_id });
    
    if (!name || !price || !category_id) {
      return res.status(400).json({ success: false, error: 'Name, price, and category are required' });
    }
    
    // Generate thumbnail for video if provided
    let thumbnail = null;
    if (video && video.trim() !== '') {
      thumbnail = generateYouTubeThumbnail(video);
      console.log('Generated thumbnail for video:', video, '->', thumbnail);
    }

    const newItem = {
      id: Math.max(...menuData.items.map(i => i.id), 0) + 1,
      name: generateMultilingualTranslations(name, 'item'),
      description: generateMultilingualTranslations(description, 'item'),
      price: parseFloat(price),
      image: image || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
      video: video && video.trim() !== '' ? video : null,
      thumbnail: thumbnail, // Add thumbnail field
      category_id: parseInt(category_id),
      active: true,
      ingredients: generateMultilingualTranslations(ingredients, 'item'),
      nutrition: generateMultilingualTranslations(nutrition, 'item'),
      allergies: generateMultilingualTranslations(allergies, 'item'),
      prepTime: generateMultilingualTranslations(prepTime, 'item')
    };
    
    // Save to database if connected
    if (mongoose.connection.readyState === 1) {
      await MenuItem.create(newItem);
      console.log('✅ Menu item saved to MongoDB');
    }
    
    // Also save to local data for compatibility
    menuData.items.push(newItem);
    saveMenuData(); // Fallback to file storage
    
    console.log('New menu item created:', newItem);
    res.json({ success: true, item: newItem });
  } catch (error) {
    console.error('Error creating menu item:', error);
    res.status(500).json({ success: false, error: 'Failed to create menu item' });
  }
});

app.put('/api/menu/items/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { name, description, price, image, category_id, ingredients, nutrition, allergies, prepTime, video, active } = req.body;
    console.log('PUT /api/menu/items/' + itemId + ' - Received data:', { name, video, image, category_id });
    
    const itemIndex = menuData.items.findIndex(item => item.id === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    
    // Generate thumbnail for video if provided
    let thumbnail = menuData.items[itemIndex].thumbnail; // Keep existing thumbnail
    if (video !== undefined && video && video.trim() !== '') {
      thumbnail = generateYouTubeThumbnail(video);
      console.log('Generated thumbnail for updated video:', video, '->', thumbnail);
    } else if (video === '') {
      thumbnail = null; // Clear thumbnail if video is removed
    }

    const updatedItem = {
      ...menuData.items[itemIndex],
      name: name ? generateMultilingualTranslations(name, 'item') : menuData.items[itemIndex].name,
      description: description ? generateMultilingualTranslations(description, 'item') : menuData.items[itemIndex].description,
      price: price !== undefined ? parseFloat(price) : menuData.items[itemIndex].price,
      image: image || menuData.items[itemIndex].image,
      video: video !== undefined ? (video === '' ? null : video) : menuData.items[itemIndex].video,
      thumbnail: thumbnail, // Add/update thumbnail field
      category_id: category_id !== undefined ? parseInt(category_id) : menuData.items[itemIndex].category_id,
      ingredients: ingredients ? generateMultilingualTranslations(ingredients, 'item') : menuData.items[itemIndex].ingredients,
      nutrition: nutrition ? generateMultilingualTranslations(nutrition, 'item') : menuData.items[itemIndex].nutrition,
      allergies: allergies ? generateMultilingualTranslations(allergies, 'item') : menuData.items[itemIndex].allergies,
      prepTime: prepTime ? generateMultilingualTranslations(prepTime, 'item') : menuData.items[itemIndex].prepTime,
      active: active !== undefined ? active : menuData.items[itemIndex].active
    };
    
    // Update in database if connected
    if (mongoose.connection.readyState === 1) {
      await MenuItem.findOneAndUpdate({ id: itemId }, updatedItem, { upsert: true });
      console.log('✅ Menu item updated in MongoDB');
    }
    
    // Also update local data
    menuData.items[itemIndex] = updatedItem;
    saveMenuData(); // Fallback to file storage
    
    console.log('Menu item updated:', updatedItem);
    res.json({ success: true, item: updatedItem });
  } catch (error) {
    console.error('Error updating menu item:', error);
    res.status(500).json({ success: false, error: 'Failed to update menu item' });
  }
});

app.delete('/api/menu/items/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const itemIndex = menuData.items.findIndex(item => item.id === itemId);
    
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    
    // Delete from database if connected
    if (mongoose.connection.readyState === 1) {
      await MenuItem.findOneAndDelete({ id: itemId });
      console.log('✅ Menu item deleted from MongoDB');
    }
    
    // Also delete from local data
    menuData.items.splice(itemIndex, 1);
    saveMenuData(); // Fallback to file storage
    console.log('Menu item deleted:', itemId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting menu item:', error);
    res.status(500).json({ success: false, error: 'Failed to delete menu item' });
  }
});

// Category Management API Routes
app.post('/api/menu/categories', async (req, res) => {
  try {
    const { name, icon, sort_order } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }
    
    const newCategory = {
      id: Math.max(...menuData.categories.map(c => c.id), 0) + 1,
      name: generateMultilingualTranslations(name, 'category'),
      icon: icon || '🍽️',
      sort_order: sort_order || menuData.categories.length + 1,
      active: true
    };
    
    // Save to database if connected
    if (mongoose.connection.readyState === 1) {
      await Category.create(newCategory);
      console.log('✅ Category saved to MongoDB');
    }
    
    // Also save to local data
    menuData.categories.push(newCategory);
    saveMenuData(); // Fallback to file storage
    
    console.log('New category created:', newCategory);
    res.json({ success: true, category: newCategory });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, error: 'Failed to create category' });
  }
});

app.put('/api/menu/categories/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);
    const { name, icon, sort_order, active } = req.body;
    
    const categoryIndex = menuData.categories.findIndex(cat => cat.id === categoryId);
    if (categoryIndex === -1) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }
    
    const updatedCategory = {
      ...menuData.categories[categoryIndex],
      name: name ? generateMultilingualTranslations(name, 'category') : menuData.categories[categoryIndex].name,
      icon: icon || menuData.categories[categoryIndex].icon,
      sort_order: sort_order !== undefined ? parseInt(sort_order) : menuData.categories[categoryIndex].sort_order,
      active: active !== undefined ? active : menuData.categories[categoryIndex].active
    };
    
    // Update in database if connected
    if (mongoose.connection.readyState === 1) {
      await Category.findOneAndUpdate({ id: categoryId }, updatedCategory, { upsert: true });
      console.log('✅ Category updated in MongoDB');
    }
    
    // Also update local data
    menuData.categories[categoryIndex] = updatedCategory;
    saveMenuData(); // Fallback to file storage
    
    console.log('Category updated:', updatedCategory);
    res.json({ success: true, category: updatedCategory });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
});

app.delete('/api/menu/categories/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);
    const categoryIndex = menuData.categories.findIndex(cat => cat.id === categoryId);
    
    if (categoryIndex === -1) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }
    
    // Check if any items are using this category
    const itemsUsingCategory = menuData.items.filter(item => item.category_id === categoryId);
    if (itemsUsingCategory.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot delete category. ${itemsUsingCategory.length} items are using this category.` 
      });
    }
    
    // Delete from database if connected
    if (mongoose.connection.readyState === 1) {
      await Category.findOneAndDelete({ id: categoryId });
      console.log('✅ Category deleted from MongoDB');
    }
    
    // Also delete from local data
    menuData.categories.splice(categoryIndex, 1);
    saveMenuData(); // Fallback to file storage
    console.log('Category deleted:', categoryId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});

app.get('/api/settings', (req, res) => {
  res.json({
    restaurantName: 'AROMA Restaurant',
    currency: 'EUR',
    taxRate: 0.18,
    serviceCharge: 0.10,
    deliveryFee: 2.50
  });
});

app.post('/api/orders', async (req, res) => {
  try {
    const { items, orderType, tableNumber, customerName, customerEmail, marketingConsent, total } = req.body;
    
    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Items are required' });
    }
    
    if (!total || isNaN(total)) {
      return res.status(400).json({ success: false, error: 'Valid total is required' });
    }

    if (!customerName || !customerEmail) {
      return res.status(400).json({ success: false, error: 'Customer name and email are required' });
    }
    
    const newOrder = {
      id: orderIdCounter++,
      items: items.map(item => {
        const menuItem = menuData.items.find(i => i.id === item.id);
        return {
          id: item.id || 0,
          name: menuItem ? (typeof menuItem.name === 'string' ? menuItem.name : menuItem.name.en) : 'Unknown Item',
          price: menuItem ? (menuItem.price || 0) : 0,
          qty: item.qty || 1
        };
      }),
      orderType: orderType || 'dine-in',
      tableNumber: tableNumber || null,
      customerName: customerName,
      customerEmail: customerEmail,
      marketingConsent: marketingConsent || false,
      total: parseFloat(total) || 0,
      status: 'pending',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    
    // Save to MongoDB if connected, otherwise save to files
    try {
      if (mongoose.connection.readyState === 1) {
        const orderDoc = new Order(newOrder);
        await orderDoc.save();
        console.log('✅ Order saved to MongoDB Atlas');
        // Also save to files as backup
        saveOrdersData();
      } else {
        // MongoDB not connected, save to files only
        saveOrdersData();
        console.log('✅ Order saved to file storage');
      }
    } catch (error) {
      console.error('❌ Error saving order to MongoDB:', error);
      // Fallback to file storage
      saveOrdersData();
      console.log('✅ Order saved to file storage (fallback)');
    }
    
    console.log('New order created:', newOrder);
    console.log('📊 Current orders count:', orders.length);
    console.log('📧 Marketing consent:', marketingConsent ? 'Yes' : 'No');
    
    // Save client if marketing consent is given
    if (marketingConsent) {
      try {
        // Check if client exists in MongoDB
        let existingClient = null;
        if (mongoose.connection.readyState === 1) {
          existingClient = await Client.findOne({ email: customerEmail });
        } else {
          existingClient = clients.find(c => c.email === customerEmail);
        }
        
        if (!existingClient) {
          const newClient = {
            id: clients.length > 0 ? Math.max(...clients.map(c => c.id)) + 1 : 1,
            name: customerName,
            email: customerEmail,
            marketingConsent: true,
            totalOrders: 1,
            totalSpent: parseFloat(total),
            createdAt: new Date().toISOString()
          };
          
          // Save to MongoDB if connected
          if (mongoose.connection.readyState === 1) {
            await Client.create(newClient);
            console.log('✅ New client saved to MongoDB:', newClient);
          }
          
          // Save to file storage
          clients.push(newClient);
          saveClientsData();
          console.log('✅ New client added to marketing list:', newClient);
        } else {
          // Update existing client
          existingClient.totalOrders = (existingClient.totalOrders || 0) + 1;
          existingClient.totalSpent = (existingClient.totalSpent || 0) + parseFloat(total);
          
          // Update in MongoDB if connected
          if (mongoose.connection.readyState === 1) {
            await Client.findByIdAndUpdate(existingClient._id, {
              totalOrders: existingClient.totalOrders,
              totalSpent: existingClient.totalSpent,
              updatedAt: new Date()
            });
            console.log('✅ Updated client in MongoDB:', existingClient);
          }
          
          // Update in file storage
          saveClientsData();
          console.log('✅ Existing client updated:', existingClient);
        }
      } catch (error) {
        console.error('❌ Error saving client:', error);
        // Continue with order creation even if client saving fails
      }
    }
    
    // Send email confirmation
    console.log('📧 Attempting to send email to:', customerEmail);
    const emailResult = await sendOrderConfirmation(newOrder, customerEmail, customerName);
    console.log('📧 Email result:', emailResult);
    
    res.json({ 
      success: true, 
      orderId: newOrder.id,
      emailSent: emailResult.success,
      emailMessage: emailResult.message || emailResult.error
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// Admin Dashboard Routes
app.get('/admin', authMiddleware, (req, res) => {
  try {
    const pending = orders.filter(o => o.status === 'pending').length;
    const confirmed = orders.filter(o => o.status === 'confirmed').length;
    const completed = orders.filter(o => o.status === 'completed').length;
    const cancelled = orders.filter(o => o.status === 'cancelled').length;
    // Calculate sales excluding cancelled orders
    const activeOrders = orders.filter(o => o.status !== 'cancelled');
    const totalSales = activeOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const completedSales = orders.filter(o => o.status === 'completed').reduce((sum, order) => sum + (order.total || 0), 0);
    // Calculate accurate analytics data based on individual items
    const categoryStats = {};
    
    console.log('🔍 Calculating category performance...');
    console.log('📊 Total orders:', orders.length);
    console.log('📊 Total categories:', menuData.categories.length);
    console.log('📊 Total menu items:', menuData.items.length);
    
    menuData.categories.forEach(cat => {
      let categoryRevenue = 0;
      let categoryOrders = 0;
      
      console.log(`\n🔍 Processing category: ${typeof cat.name === 'string' ? cat.name : cat.name.en} (ID: ${cat.id})`);
      
      // Calculate revenue based on individual items, excluding cancelled orders
      orders.forEach((order, orderIndex) => {
        if (order.items && order.status !== 'cancelled') { // Exclude cancelled orders
          let hasItemsInCategory = false;
          order.items.forEach((orderItem, itemIndex) => {
            const menuItem = menuData.items.find(i => i.id === orderItem.id);
            if (menuItem && menuItem.category_id === cat.id) {
              const itemRevenue = orderItem.price * orderItem.qty;
              categoryRevenue += itemRevenue;
              hasItemsInCategory = true;
              console.log(`  ✅ Found item in category: ${menuItem.name.en || menuItem.name} - €${itemRevenue}`);
            }
          });
          if (hasItemsInCategory) {
            categoryOrders++;
            console.log(`  📊 Order ${order.id} counted for category`);
          }
        }
      });
      
      const categoryName = typeof cat.name === 'string' ? cat.name : cat.name.en;
      categoryStats[categoryName] = {
        orders: categoryOrders,
        revenue: categoryRevenue
      };
      
      console.log(`📊 FINAL ${categoryName}: €${categoryRevenue} revenue, ${categoryOrders} orders`);
    });
    
    console.log('📊 Category Performance Stats:', categoryStats);
    
    res.render('admin_dashboard', {
      stats: { pending, confirmed, completed, cancelled, totalSales, completedSales },
      recentOrders: orders.slice(-10).reverse(),
      categoryStats,
      orders: orders,
      menuData: menuData
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/orders', authMiddleware, (req, res) => {
  try {
    res.render('admin_orders', { orders: orders || [] });
  } catch (error) {
    console.error('Admin orders error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/clients', authMiddleware, (req, res) => {
  try {
    res.render('admin_clients', { clients: clients || [] });
  } catch (error) {
    console.error('Admin clients error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/items', authMiddleware, (req, res) => {
  try {
    console.log('🔄 Loading admin items page...');
    console.log('📊 Menu data items count:', menuData.items ? menuData.items.length : 'undefined');
    console.log('📊 Menu data categories count:', menuData.categories ? menuData.categories.length : 'undefined');
    
    if (menuData.items && menuData.items.length > 0) {
      console.log('📋 Sample item:', menuData.items[0]);
      console.log('📋 Sample item category_id:', menuData.items[0].category_id);
    }
    if (menuData.categories && menuData.categories.length > 0) {
      console.log('📋 Sample category:', menuData.categories[0]);
      console.log('📋 Sample category name type:', typeof menuData.categories[0].name);
    }
    
    res.render('admin_items', { 
      items: menuData.items || [],
      categories: menuData.categories || []
    });
  } catch (error) {
    console.error('❌ Admin items error:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/categories', authMiddleware, (req, res) => {
  try {
    res.render('admin_categories', { 
      categories: menuData.categories || [],
      items: menuData.items || []
    });
  } catch (error) {
    console.error('Admin categories error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/settings', authMiddleware, (req, res) => {
  try {
    res.render('admin_settings', { 
      settings: {
        restaurantName: 'AROMA Restaurant',
        currency: 'EUR',
        taxRate: 0.18,
        serviceCharge: 0.10,
        deliveryFee: 2.50
      }
    });
  } catch (error) {
    console.error('Admin settings error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Pending Orders Page
app.get('/admin/orders/pending', authMiddleware, (req, res) => {
  try {
    const pendingOrders = orders.filter(o => o.status === 'pending')
      .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    res.render('admin_orders_status', {
      title: 'Pending Orders',
      orders: pendingOrders,
      status: 'pending',
      stats: {
        total: pendingOrders.length,
        totalValue: pendingOrders.reduce((sum, order) => sum + (order.total || 0), 0)
      }
    });
  } catch (error) {
    console.error('Pending orders error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Confirmed Orders Page
app.get('/admin/orders/confirmed', authMiddleware, (req, res) => {
  try {
    const confirmedOrders = orders.filter(o => o.status === 'confirmed')
      .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    res.render('admin_orders_status', {
      title: 'Confirmed Orders',
      orders: confirmedOrders,
      status: 'confirmed',
      stats: {
        total: confirmedOrders.length,
        totalValue: confirmedOrders.reduce((sum, order) => sum + (order.total || 0), 0)
      }
    });
  } catch (error) {
    console.error('Confirmed orders error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Completed Orders Page
app.get('/admin/orders/completed', authMiddleware, (req, res) => {
  try {
    const completedOrders = orders.filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    res.render('admin_orders_status', {
      title: 'Completed Orders',
      orders: completedOrders,
      status: 'completed',
      stats: {
        total: completedOrders.length,
        totalValue: completedOrders.reduce((sum, order) => sum + (order.total || 0), 0)
      }
    });
  } catch (error) {
    console.error('Completed orders error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Sales Analytics Page
app.get('/admin/sales', authMiddleware, (req, res) => {
  try {
    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalSales = completedOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    // Calculate daily, weekly, monthly sales
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    
    const dailySales = completedOrders
      .filter(o => new Date(o.timestamp || o.createdAt) >= today)
      .reduce((sum, order) => sum + (order.total || 0), 0);
    
    const weeklySales = completedOrders
      .filter(o => new Date(o.timestamp || o.createdAt) >= weekStart)
      .reduce((sum, order) => sum + (order.total || 0), 0);
    
    const monthlySales = completedOrders
      .filter(o => new Date(o.timestamp || o.createdAt) >= monthStart)
      .reduce((sum, order) => sum + (order.total || 0), 0);
    
    const yearlySales = completedOrders
      .filter(o => new Date(o.timestamp || o.createdAt) >= yearStart)
      .reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales', {
      stats: {
        total: totalSales,
        daily: dailySales,
        weekly: weeklySales,
        monthly: monthlySales,
        yearly: yearlySales
      },
      orders: completedOrders
    });
  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Daily Sales Breakdown
app.get('/admin/sales/daily', authMiddleware, (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    const dailyOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp || o.createdAt);
      return orderDate >= today && orderDate < tomorrow;
    }).sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    const totalSales = dailyOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales_breakdown', {
      title: 'Daily Sales Breakdown',
      period: 'daily',
      orders: dailyOrders,
      stats: {
        total: dailyOrders.length,
        totalValue: totalSales,
        date: today.toLocaleDateString()
      }
    });
  } catch (error) {
    console.error('Daily sales error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Weekly Sales Breakdown
app.get('/admin/sales/weekly', authMiddleware, (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
    const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
    
    const weeklyOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp || o.createdAt);
      return orderDate >= weekStart && orderDate < weekEnd;
    }).sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    const totalSales = weeklyOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales_breakdown', {
      title: 'Weekly Sales Breakdown',
      period: 'weekly',
      orders: weeklyOrders,
      stats: {
        total: weeklyOrders.length,
        totalValue: totalSales,
        date: `${weekStart.toLocaleDateString()} - ${new Date(weekEnd.getTime() - 1).toLocaleDateString()}`
      }
    });
  } catch (error) {
    console.error('Weekly sales error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Monthly Sales Breakdown
app.get('/admin/sales/monthly', authMiddleware, (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    
    const monthlyOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp || o.createdAt);
      return orderDate >= monthStart && orderDate < nextMonth;
    }).sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    const totalSales = monthlyOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales_breakdown', {
      title: 'Monthly Sales Breakdown',
      period: 'monthly',
      orders: monthlyOrders,
      stats: {
        total: monthlyOrders.length,
        totalValue: totalSales,
        date: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      }
    });
  } catch (error) {
    console.error('Monthly sales error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Yearly Sales Breakdown
app.get('/admin/sales/yearly', authMiddleware, (req, res) => {
  try {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const nextYear = new Date(now.getFullYear() + 1, 0, 1);
    
    const yearlyOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp || o.createdAt);
      return orderDate >= yearStart && orderDate < nextYear;
    }).sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
    
    const totalSales = yearlyOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales_breakdown', {
      title: 'Yearly Sales Breakdown',
      period: 'yearly',
      orders: yearlyOrders,
      stats: {
        total: yearlyOrders.length,
        totalValue: totalSales,
        date: yearStart.getFullYear().toString()
      }
    });
  } catch (error) {
    console.error('Yearly sales error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// API endpoints for admin
app.get('/admin/api/orders', authMiddleware, (req, res) => {
  res.json(orders);
});

// Update order status
app.post('/admin/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
  const { status } = req.body;
    
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    // Save to MongoDB if connected, otherwise save to files
    try {
      if (mongoose.connection.readyState === 1) {
        // Use the MongoDB _id if available, otherwise find by order id
        const mongoId = orders[orderIndex]._id;
        if (mongoId) {
          await Order.findByIdAndUpdate(mongoId, 
            { status: status, updatedAt: new Date().toISOString() });
          console.log('✅ Order status updated in MongoDB Atlas');
        } else {
          // Fallback: find by order id and update
          await Order.findOneAndUpdate({ id: orderId }, 
            { status: status, updatedAt: new Date().toISOString() });
          console.log('✅ Order status updated in MongoDB Atlas (by order id)');
        }
        // Also save to files as backup
        saveOrdersData();
      } else {
        // MongoDB not connected, save to files only
        saveOrdersData();
        console.log('✅ Order status updated in file storage');
      }
    } catch (error) {
      console.error('❌ Error updating order status in MongoDB:', error);
      // Fallback to file storage
      saveOrdersData();
      console.log('✅ Order status updated in file storage (fallback)');
    }
    
    console.log(`Order ${orderId} status updated to: ${status}`);
    res.json({ success: true, order: orders[orderIndex] });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Edit order (with discount support)
app.post('/admin/orders/:id/edit', authMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { customerName, customerEmail, orderType, status, discount, notes } = req.body;
    
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Update order details
    orders[orderIndex].customerName = customerName;
    orders[orderIndex].customerEmail = customerEmail;
    orders[orderIndex].orderType = orderType;
    orders[orderIndex].status = status;
    orders[orderIndex].discount = parseFloat(discount) || 0;
    orders[orderIndex].notes = notes || '';
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    // Recalculate total with discount
    const originalTotal = orders[orderIndex].items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    orders[orderIndex].total = Math.max(0, originalTotal - (parseFloat(discount) || 0));
    
    saveOrdersData(); // Save orders to file
    
    console.log(`Order ${orderId} edited: Customer=${customerName}, Discount=€${discount}, New Total=€${orders[orderIndex].total}`);
    res.json({ success: true, order: orders[orderIndex] });
  } catch (error) {
    console.error('Error editing order:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Clients API endpoints
app.get('/admin/api/clients', authMiddleware, (req, res) => {
  res.json(clients);
});

// Delete client
app.delete('/admin/clients/:id', authMiddleware, (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    const clientIndex = clients.findIndex(c => c.id === clientId);
    
    if (clientIndex === -1) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    
    clients.splice(clientIndex, 1);
    saveClientsData();
    
    console.log(`Client ${clientId} deleted successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// Kitchen Staff Routes
app.get('/kitchen', kitchenAuthMiddleware, (req, res) => {
  try {
    const pendingOrders = orders.filter(o => o.status === 'pending');
    const confirmedOrders = orders.filter(o => o.status === 'confirmed');
    
    res.render('kitchen_dashboard', {
      pendingOrders,
      confirmedOrders,
      totalOrders: orders.length
    });
  } catch (error) {
    console.error('Kitchen dashboard error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/kitchen/orders', kitchenAuthMiddleware, (req, res) => {
  try {
    const allOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
    res.render('kitchen_orders', { orders: allOrders });
  } catch (error) {
    console.error('Kitchen orders error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.post('/kitchen/orders/:id/status', kitchenAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const order = orders.find(o => o.id === parseInt(id));
    if (order) {
      order.status = status;
      saveOrdersData(); // Save orders to file
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Order not found' });
    }
  } catch (error) {
    console.error('Kitchen order status update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found', 
    message: 'The requested resource was not found',
    timestamp: new Date().toISOString()
  });
});

// Save clients data to file
function saveClientsData() {
  try {
    const clientsData = JSON.stringify(clients, null, 2);
    
    // Ensure data directory exists before writing
    const dataDir = path.dirname(CLIENTS_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(CLIENTS_DATA_FILE, clientsData, 'utf8');
    fs.writeFileSync(CLIENTS_DATA_BACKUP, clientsData, 'utf8');
    console.log(`✅ Clients data saved successfully (${clients.length} clients, ${clientsData.length} bytes)`);
  } catch (error) {
    console.error('❌ Error saving clients data:', error);
  }
}

// Load clients data from file
async function loadClientsData() {
  try {
    // First try to load from MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        console.log('🔄 Loading clients from MongoDB Atlas...');
        const mongoClients = await Client.find().sort({ createdAt: -1 });
        clients = mongoClients.map(client => client.toObject());
        console.log(`✅ Clients data loaded from MongoDB Atlas (${clients.length} clients)`);
        return;
      } catch (error) {
        console.error('❌ Error loading clients from MongoDB:', error);
        // Fall back to file storage
      }
    }
    
    // Load from file storage
    let data;
    if (fs.existsSync(CLIENTS_DATA_FILE)) {
      data = fs.readFileSync(CLIENTS_DATA_FILE, 'utf8');
    } else if (fs.existsSync(CLIENTS_DATA_BACKUP)) {
      data = fs.readFileSync(CLIENTS_DATA_BACKUP, 'utf8');
    } else {
      console.log('📝 No clients data file found, starting with empty array');
      return;
    }
    
    const parsedData = JSON.parse(data);
    clients = parsedData || [];
    console.log(`✅ Clients data loaded from file storage (${clients.length} clients)`);
  } catch (error) {
    console.error('❌ Error loading clients data:', error);
    clients = [];
  }
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`API health: http://localhost:${PORT}/health`);
  
  // Connect to database using new module
  const dbConnected = await connectToDatabase();
  
  if (dbConnected) {
    // Load data from database
    console.log('🔄 Loading data from MongoDB...');
    const dbData = await loadDataFromDatabase();
    if (dbData) {
      menuData.categories = dbData.categories;
      menuData.items = dbData.items;
      orders = dbData.orders;
      clients = dbData.clients;
      console.log('✅ Data loaded from MongoDB');
    }
  } else {
    // Fall back to file storage
    console.log('🔄 Loading data from file storage...');
    await loadMenuData();
    await loadOrdersData();
    await loadClientsData();
  }
  
  // Format data for consistency (fixes [object Object] issue)
  formatMenuData();
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
