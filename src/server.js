require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

// Import database module
const { 
  connectToDatabase, 
  loadDataFromDatabase, 
  saveDataToDatabase, 
  generateMultilingualTranslations,
  MenuItem,
  Category,
  Order,
  Client,
  Reservation,
  Availability
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
let reservations = [];
let availability = [];
let orderIdCounter = 1;
let reservationIdCounter = 1;

// Data persistence files - using multiple backup locations for reliability
const MENU_DATA_FILE = path.join(__dirname, 'data', 'menu-data.json');
const ORDERS_DATA_FILE = path.join(__dirname, 'data', 'orders-data.json');
const CLIENTS_DATA_FILE = path.join(__dirname, 'data', 'clients-data.json');
const RESERVATIONS_DATA_FILE = path.join(__dirname, 'data', 'reservations-data.json');
const AVAILABILITY_DATA_FILE = path.join(__dirname, 'data', 'availability-data.json');
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

// CRITICAL: Force load orders data immediately on startup
console.log('🚨 CRITICAL: Loading orders data on startup...');
loadOrdersData().then(() => {
  console.log('✅ Orders data loaded on startup:', orders.length, 'orders');
  console.log('🔢 Order ID counter:', orderIdCounter);
}).catch(error => {
  console.error('❌ CRITICAL ERROR loading orders on startup:', error);
  // Initialize with empty array if loading fails
  orders = [];
  orderIdCounter = 1;
  console.log('🔄 Initialized with empty orders array');
});

// Load reservations data on startup
console.log('📅 Loading reservations data on startup...');
loadReservationsData();
console.log('✅ Reservations data loaded on startup:', reservations.length, 'reservations');
console.log('📅 Sample reservation data:', reservations[0] ? JSON.stringify(reservations[0], null, 2) : 'No reservations found');

// Note: loadMenuData() and loadOrdersData() are called after MongoDB connection in app.listen()

const app = express();

// Clean up corrupted data in MongoDB
async function cleanupCorruptedData() {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    
    console.log('🔄 Checking for corrupted data...');
    
    // Clean up malformed menu items
    const items = await MenuItem.find();
    let cleanedCount = 0;
    
    console.log(`📊 Found ${items.length} items to check for corruption`);
    
    for (const item of items) {
      let needsUpdate = false;
      const updateData = {};
      
      // Fix malformed name object - be more aggressive
      if (item.name && typeof item.name === 'object') {
        const nameKeys = Object.keys(item.name);
        const hasCorruption = nameKeys.length > 10 || 
                             nameKeys.some(key => key.includes('en') && nameKeys.filter(k => k.includes('en')).length > 1) ||
                             JSON.stringify(item.name).includes('"en":') && JSON.stringify(item.name).split('"en":').length > 2;
        
        if (hasCorruption) {
          console.log(`🔍 Item ${item.id} has corrupted name structure with ${nameKeys.length} keys:`, nameKeys.slice(0, 5));
          // Completely rebuild the name object from scratch
          const cleanName = {};
          const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
          
          // Try to find a clean value for each language
          let baseValue = null;
          languages.forEach(lang => {
            const langValue = item.name[lang];
            if (langValue && typeof langValue === 'string' && langValue.trim()) {
              cleanName[lang] = langValue.trim();
              if (!baseValue) baseValue = langValue.trim();
            }
          });
          
          // If we found at least one clean value, use it for all languages
          if (baseValue) {
            languages.forEach(lang => {
              cleanName[lang] = baseValue;
            });
            updateData.name = cleanName;
            needsUpdate = true;
            // console.log(`🔧 Fixed item ${item.id} name:`, cleanName);
          } else {
            // If no clean values found, use a default
            const defaultName = `Item ${item.id}`;
            languages.forEach(lang => {
              cleanName[lang] = defaultName;
            });
            updateData.name = cleanName;
            needsUpdate = true;
            console.log(`🔧 Rebuilt item ${item.id} name with default:`, cleanName);
          }
        }
      }
      
      // Fix malformed description object
      if (item.description && typeof item.description === 'object') {
        const descKeys = Object.keys(item.description);
        if (descKeys.length > 10) {
          const cleanDesc = {};
          const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
          languages.forEach(lang => {
            const langValue = item.description[lang];
            if (langValue && typeof langValue === 'string' && langValue.trim()) {
              cleanDesc[lang] = langValue.trim();
            }
          });
          
          if (Object.keys(cleanDesc).length > 0) {
            // Fill missing languages with the first available
            const firstValue = Object.values(cleanDesc)[0];
            languages.forEach(lang => {
              if (!cleanDesc[lang]) {
                cleanDesc[lang] = firstValue;
              }
            });
            updateData.description = cleanDesc;
            needsUpdate = true;
            // console.log(`🔧 Fixed item ${item.id} description:`, cleanDesc);
          }
        }
      }
      
      // Fix other malformed objects
      ['ingredients', 'nutrition', 'allergies', 'prepTime'].forEach(field => {
        if (item[field] && typeof item[field] === 'object') {
          const fieldKeys = Object.keys(item[field]);
          if (fieldKeys.length > 10) {
            const cleanField = {};
            const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
            languages.forEach(lang => {
              const langValue = item[field][lang];
              if (langValue && typeof langValue === 'string' && langValue.trim()) {
                cleanField[lang] = langValue.trim();
              }
            });
            
            if (Object.keys(cleanField).length > 0) {
              // Fill missing languages with the first available
              const firstValue = Object.values(cleanField)[0];
              languages.forEach(lang => {
                if (!cleanField[lang]) {
                  cleanField[lang] = firstValue;
                }
              });
              updateData[field] = cleanField;
              needsUpdate = true;
              // console.log(`🔧 Fixed item ${item.id} ${field}:`, cleanField);
            }
          }
        }
      });
      
      if (needsUpdate) {
        await MenuItem.findByIdAndUpdate(item._id, updateData);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`✅ Cleaned up ${cleanedCount} corrupted menu items`);
    }
    
    // Clean up malformed categories
    const categories = await Category.find();
    let cleanedCategories = 0;
    
    for (const category of categories) {
      if (category.name && typeof category.name === 'object') {
        const nameKeys = Object.keys(category.name);
        if (nameKeys.length > 10) {
          const cleanName = {};
          const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
          languages.forEach(lang => {
            const langValue = category.name[lang];
            if (langValue && typeof langValue === 'string' && langValue.trim()) {
              cleanName[lang] = langValue.trim();
            }
          });
          
          if (Object.keys(cleanName).length > 0) {
            // Fill missing languages with the first available
            const firstValue = Object.values(cleanName)[0];
            languages.forEach(lang => {
              if (!cleanName[lang]) {
                cleanName[lang] = firstValue;
              }
            });
            await Category.findByIdAndUpdate(category._id, { name: cleanName });
            cleanedCategories++;
            // console.log(`🔧 Fixed category ${category.id} name:`, cleanName);
          }
        }
      }
    }
    
    if (cleanedCategories > 0) {
      console.log(`✅ Cleaned up ${cleanedCategories} corrupted categories`);
    }
    
    // If we still have corrupted data, do a complete rebuild
    if (cleanedCount === 0 && cleanedCategories === 0) {
      console.log('🔄 No corruption detected, but checking for subtle issues...');
      
      // Check for any items with malformed structures
      const allItems = await MenuItem.find();
      let rebuiltCount = 0;
      
      for (const item of allItems) {
        let needsRebuild = false;
        const rebuildData = {};
        
        // Check if any field has too many keys or malformed structure
        ['name', 'description', 'ingredients', 'nutrition', 'allergies', 'prepTime'].forEach(field => {
          if (item[field] && typeof item[field] === 'object') {
            const keys = Object.keys(item[field]);
            if (keys.length > 15) { // More aggressive threshold
              needsRebuild = true;
              console.log(`🔍 Item ${item.id} ${field} has ${keys.length} keys, rebuilding...`);
              
              // Rebuild with clean structure
              const cleanField = {};
              const languages = ['en', 'mt', 'es', 'it', 'fr', 'de', 'ru', 'pt', 'nl', 'pl'];
              const firstValue = Object.values(item[field]).find(v => v && typeof v === 'string' && v.trim()) || `Default ${field}`;
              
              languages.forEach(lang => {
                cleanField[lang] = firstValue;
              });
              
              rebuildData[field] = cleanField;
            }
          }
        });
        
        if (needsRebuild) {
          await MenuItem.findByIdAndUpdate(item._id, rebuildData);
          rebuiltCount++;
              // console.log(`🔧 Rebuilt item ${item.id} completely`);
        }
      }
      
      if (rebuiltCount > 0) {
        console.log(`✅ Rebuilt ${rebuiltCount} items with complete structure`);
      }
    }
    
  } catch (error) {
    console.error('❌ Data cleanup error:', error);
  }
}

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
            
            ${order.notes && order.notes.trim() ? `
            <div style="background: #fee2e2; border: 2px solid #dc2626; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #dc2626; margin-top: 0; font-size: 16px;">⚠️ SPECIAL INSTRUCTIONS</h3>
              <p style="margin: 0; color: #dc2626; font-weight: 700; white-space: pre-wrap;">${order.notes}</p>
            </div>
            ` : ''}
            
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

// Serve static files from the frontend build (only if directory exists)
const frontendPath = path.join(__dirname, '../AROMA_FRONTEND/dist');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

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

// Root route - redirect to admin or show API info
app.get('/', (req, res) => {
  const frontendIndexPath = path.join(__dirname, '../AROMA_FRONTEND/dist/index.html');
  if (fs.existsSync(frontendIndexPath)) {
    res.sendFile(frontendIndexPath);
  } else {
    res.json({
      message: 'Restaurant Backend API',
      admin: '/admin',
      health: '/health',
      frontend: 'https://aroma-frontend-delta.vercel.app'
    });
  }
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

// QR Code Management API Routes
app.get('/api/qr/generate/:tableNumber', async (req, res) => {
  try {
    const { tableNumber } = req.params;
    
    if (!tableNumber || isNaN(tableNumber)) {
      return res.status(400).json({ success: false, error: 'Valid table number is required' });
    }
    
    // Create the URL that the QR code will point to
    const baseUrl = process.env.FRONTEND_URL || 'https://aroma-frontend-delta.vercel.app';
    const qrUrl = `${baseUrl}?table=${tableNumber}`;
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
  res.json({
      success: true,
      tableNumber: parseInt(tableNumber),
      qrUrl: qrUrl,
      qrCode: qrCodeDataUrl
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

app.get('/api/qr/batch/:startTable/:endTable', async (req, res) => {
  try {
    const { startTable, endTable } = req.params;
    const start = parseInt(startTable);
    const end = parseInt(endTable);
    
    if (isNaN(start) || isNaN(end) || start > end) {
      return res.status(400).json({ success: false, error: 'Valid start and end table numbers are required' });
    }
    
    const baseUrl = process.env.FRONTEND_URL || 'https://aroma-frontend-delta.vercel.app';
    const qrCodes = [];
    
    for (let tableNum = start; tableNum <= end; tableNum++) {
      const qrUrl = `${baseUrl}?table=${tableNum}`;
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      qrCodes.push({
        tableNumber: tableNum,
        qrUrl: qrUrl,
        qrCode: qrCodeDataUrl
      });
    }
    
    res.json({
      success: true,
      qrCodes: qrCodes
    });
  } catch (error) {
    console.error('Error generating batch QR codes:', error);
    res.status(500).json({ success: false, error: 'Failed to generate QR codes' });
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
    console.log('🚨 ORDER CREATION STARTED');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📊 Current orders count before:', orders.length);
    console.log('🔢 Current orderIdCounter:', orderIdCounter);
    
    const { items, orderType, tableNumber, customerName, customerEmail, notes, marketingConsent, total } = req.body;
    
    // Log table number specifically
    console.log('🪑 TABLE NUMBER RECEIVED:', tableNumber, '(type:', typeof tableNumber, ')');
    console.log('📝 NOTES RECEIVED:', notes);
    
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
    
    // Ensure table number is stored as string for consistency
    const normalizedTableNumber = tableNumber ? String(tableNumber) : null;
    console.log('🪑 TABLE NUMBER NORMALIZED:', normalizedTableNumber);
    
    const newOrder = {
      id: orderIdCounter++,
      items: items.map(item => {
        const menuItem = menuData.items.find(i => i.id === item.id);
        return {
          id: item.id || 0,
          name: menuItem ? (typeof menuItem.name === 'string' ? menuItem.name : menuItem.name.en) : 'Unknown Item',
          price: menuItem ? (menuItem.price || 0) : 0,
          qty: item.qty || 1,
          quantity: item.qty || 1  // Add both for compatibility
        };
      }),
      orderType: orderType || 'dine-in',
      tableNumber: normalizedTableNumber,
      customerName: customerName,
      customerEmail: customerEmail,
      notes: notes || '', // Special instructions for kitchen
      marketingConsent: marketingConsent || false,
      total: parseFloat(total) || 0,
      status: 'pending',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    
    // FIXED: Prevent duplicate order creation
    try {
      if (mongoose.connection.readyState === 1) {
        // Check if order already exists in MongoDB
        const existingOrder = await Order.findOne({ id: newOrder.id });
        if (existingOrder) {
          console.log(`⚠️ Order ${newOrder.id} already exists in MongoDB, skipping creation`);
        } else {
          // Create new order in MongoDB
          const orderDoc = new Order(newOrder);
          await orderDoc.save();
          console.log(`✅ Order ${newOrder.id} saved to MongoDB Atlas`);
          console.log(`🪑 Order table number in MongoDB: ${orderDoc.tableNumber}`);
        }
        
        // Save to files as backup (only if not already saved)
        saveOrdersData();
        console.log(`✅ Order ${newOrder.id} backup saved to files`);
      } else {
        // MongoDB not connected, save to files only
        saveOrdersData();
        console.log(`✅ Order ${newOrder.id} saved to file storage`);
      }
    } catch (error) {
      console.error(`❌ Error saving order ${newOrder.id} to MongoDB:`, error);
      // Only fallback to file storage if MongoDB save failed
      saveOrdersData();
      console.log(`✅ Order ${newOrder.id} saved to file storage (fallback)`);
    }
    
    console.log('🚨 ORDER CREATION COMPLETED');
    console.log('🆕 New order created:', JSON.stringify(newOrder, null, 2));
    console.log('📊 Current orders count:', orders.length);
    console.log('🔢 Next orderIdCounter:', orderIdCounter);
    console.log('📧 Marketing consent:', marketingConsent ? 'Yes' : 'No');
    
    // CRITICAL: Force immediate data persistence
    console.log('💾 FORCING IMMEDIATE DATA SAVE...');
    try {
      saveOrdersData();
      console.log('✅ IMMEDIATE SAVE COMPLETED');
    } catch (saveError) {
      console.error('❌ IMMEDIATE SAVE FAILED:', saveError);
    }
    
    // CRITICAL: Force data reload to ensure synchronization
    console.log('🔄 FORCING DATA RELOAD FOR SYNCHRONIZATION...');
    try {
      await loadOrdersData();
      console.log('✅ DATA RELOAD COMPLETED - Orders count:', orders.length);
    } catch (reloadError) {
      console.error('❌ DATA RELOAD FAILED:', reloadError);
    }
    
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
          // Update existing client with most recent order date
          existingClient.totalOrders = (existingClient.totalOrders || 0) + 1;
          existingClient.totalSpent = (existingClient.totalSpent || 0) + parseFloat(total);
          existingClient.updatedAt = new Date().toISOString();
          
          // Update in MongoDB if connected
          if (mongoose.connection.readyState === 1) {
            await Client.findByIdAndUpdate(existingClient._id, {
              totalOrders: existingClient.totalOrders,
              totalSpent: existingClient.totalSpent,
              updatedAt: new Date()
            });
            console.log('✅ Updated client in MongoDB with latest order date:', existingClient);
          }
          
          // Update in file storage
          saveClientsData();
          console.log('✅ Existing client updated with latest order date:', existingClient);
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
app.get('/admin', authMiddleware, async (req, res) => {
  try {
    let mongoOrders, mongoCategories, mongoItems;
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState === 1) {
      console.log('🔍 Loading dashboard data from MongoDB...');
      
      // Load fresh data from MongoDB
      mongoOrders = await Order.find().sort({ createdAt: -1 });
      mongoCategories = await Category.find().sort({ sort_order: 1 });
      mongoItems = await MenuItem.find();
      
      // Update local arrays to keep them in sync
      orders = mongoOrders;
      menuData.categories = mongoCategories;
      menuData.items = mongoItems;
      
      console.log('📊 MongoDB Data Loaded:');
      console.log(`📊 Orders: ${mongoOrders.length}`);
      console.log(`📊 Categories: ${mongoCategories.length}`);
      console.log(`📊 Items: ${mongoItems.length}`);
    } else {
      console.log('🔍 MongoDB not connected, using file-based data...');
      
      // Use file-based data as fallback
      mongoOrders = orders || [];
      mongoCategories = menuData.categories || [];
      mongoItems = menuData.items || [];
      
      console.log('📊 File Data Loaded:');
      console.log(`📊 Orders: ${mongoOrders.length}`);
      console.log(`📊 Categories: ${mongoCategories.length}`);
      console.log(`📊 Items: ${mongoItems.length}`);
    }
    
    // Calculate order statistics
    const pending = mongoOrders.filter(o => o.status === 'pending').length;
    const confirmed = mongoOrders.filter(o => o.status === 'confirmed').length;
    const completed = mongoOrders.filter(o => o.status === 'completed').length;
    const cancelled = mongoOrders.filter(o => o.status === 'cancelled').length;
    
    // Calculate sales excluding cancelled orders
    const activeOrders = mongoOrders.filter(o => o.status !== 'cancelled');
    const totalSales = activeOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const completedSales = mongoOrders.filter(o => o.status === 'completed').reduce((sum, order) => sum + (order.total || 0), 0);
    
    // Calculate accurate category performance from MongoDB data
    const categoryStats = {};
    
    console.log('🔍 Calculating category performance from MongoDB...');
    console.log('📊 Available categories:', mongoCategories.map(cat => ({ id: cat.id, name: cat.name })));
    console.log('📊 Available items:', mongoItems.map(item => ({ id: item.id, name: item.name, category_id: item.category_id })));
    console.log('📊 Available orders:', mongoOrders.length);
    
    // Initialize category stats
    mongoCategories.forEach(cat => {
      const categoryName = app.locals.translate(cat.name);
      categoryStats[categoryName] = {
        orders: 0,
        revenue: 0,
        items: 0
      };
      console.log(`📊 Initialized category: ${categoryName} (ID: ${cat.id})`);
    });
    
    // Calculate revenue for each category by analyzing all orders
    mongoOrders.forEach((order, orderIndex) => {
      console.log(`\n🔍 Processing order ${orderIndex + 1}: ${order.id} (status: ${order.status})`);
      
      if (order.status !== 'cancelled') {
        const orderCategories = new Set(); // Track which categories this order has items from
        
        order.items.forEach((orderItem, itemIndex) => {
          console.log(`  📦 Item ${itemIndex + 1}: ID=${orderItem.id}, price=${orderItem.price}, qty=${orderItem.quantity}`);
          console.log(`  📦 OrderItem details:`, JSON.stringify(orderItem, null, 2));
          
          // Find the menu item to get its category
          const menuItem = mongoItems.find(mi => mi.id === orderItem.id);
          if (menuItem) {
            console.log(`    ✅ Found menu item: ${menuItem.name?.en || menuItem.name}, category_id: ${menuItem.category_id}`);
            console.log(`    📋 MenuItem details:`, JSON.stringify(menuItem, null, 2));
            
            if (menuItem.category_id) {
              // Find the category
              const category = mongoCategories.find(cat => cat.id === menuItem.category_id);
              if (category) {
                const categoryName = app.locals.translate(category.name);
                // Handle different data structures for price and quantity
                const price = orderItem.price || orderItem.itemPrice || 0;
                const quantity = orderItem.quantity || orderItem.qty || orderItem.amount || 1;
                const itemTotal = price * quantity;
                
                console.log(`    📊 Category: ${categoryName}, Item total: €${itemTotal}`);
                console.log(`    📊 Price: ${price}, Quantity: ${quantity}`);
                
                if (categoryStats[categoryName]) {
                  categoryStats[categoryName].revenue += itemTotal;
                  categoryStats[categoryName].items += quantity;
                  orderCategories.add(categoryName);
                  
                  console.log(`    ✅ Added to category ${categoryName}: +€${itemTotal} (${quantity} items)`);
                  console.log(`    📊 Category ${categoryName} new total: €${categoryStats[categoryName].revenue}`);
                } else {
                  console.log(`    ❌ Category ${categoryName} not found in categoryStats`);
                }
              } else {
                console.log(`    ❌ Category with ID ${menuItem.category_id} not found`);
              }
            } else {
              console.log(`    ❌ Menu item has no category_id`);
            }
          } else {
            console.log(`    ❌ Menu item with ID ${orderItem.id} not found in database`);
          }
        });
        
        // Count this order for each category it contains
        orderCategories.forEach(categoryName => {
          if (categoryStats[categoryName]) {
            categoryStats[categoryName].orders += 1;
            console.log(`  📊 Order counted for category: ${categoryName}`);
          }
        });
      } else {
        console.log(`  ⏭️ Skipping cancelled order`);
      }
    });
    
    console.log('📊 Category Performance Stats:', categoryStats);
    
    // If no revenue calculated, try alternative approach using order totals
    const totalRevenue = Object.values(categoryStats).reduce((sum, cat) => sum + cat.revenue, 0);
    if (totalRevenue === 0 && mongoOrders.length > 0) {
      console.log('⚠️ No revenue calculated from items, trying alternative approach...');
      
      // Reset category stats
      Object.keys(categoryStats).forEach(key => {
        categoryStats[key] = { orders: 0, revenue: 0, items: 0 };
      });
      
      // Distribute order totals evenly across categories
      mongoOrders.forEach(order => {
        if (order.status !== 'cancelled' && order.total > 0) {
          const orderCategories = new Set();
          
          order.items.forEach(orderItem => {
            const menuItem = mongoItems.find(mi => mi.id === orderItem.id);
            if (menuItem && menuItem.category_id) {
              const category = mongoCategories.find(cat => cat.id === menuItem.category_id);
              if (category) {
                const categoryName = app.locals.translate(category.name);
                orderCategories.add(categoryName);
              }
            }
          });
          
          // Distribute order total across categories
          if (orderCategories.size > 0) {
            const revenuePerCategory = order.total / orderCategories.size;
            orderCategories.forEach(categoryName => {
              if (categoryStats[categoryName]) {
                categoryStats[categoryName].revenue += revenuePerCategory;
                categoryStats[categoryName].orders += 1;
                categoryStats[categoryName].items += 1; // Approximate
              }
            });
          }
        }
      });
      
      console.log('📊 Alternative calculation completed:', categoryStats);
    }
    
    // Get today's bookings count
    const today = new Date().toISOString().split('T')[0];
    let todayBookings = 0;
    
    if (mongoose.connection.readyState === 1) {
      const todayReservations = await Reservation.find({
        reservationDate: {
          $gte: new Date(today),
          $lt: new Date(today + 'T23:59:59.999Z')
        }
      });
      todayBookings = todayReservations.length;
    } else {
      todayBookings = reservations.filter(r => 
        new Date(r.reservationDate).toISOString().split('T')[0] === today
      ).length;
    }
    
    res.render('admin_dashboard', {
      stats: { pending, confirmed, completed, cancelled, totalSales, completedSales, bookings: todayBookings },
      categoryStats,
      orders: mongoOrders,
      menuData: { categories: mongoCategories, items: mongoItems }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/orders', authMiddleware, async (req, res) => {
  try {
    let mongoOrders;
    
    if (mongoose.connection.readyState === 1) {
      mongoOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`📊 ADMIN ORDERS: Loaded ${mongoOrders.length} orders from MongoDB`);
      
      // Log table numbers for debugging (first 10 orders)
      console.log('📊 ADMIN ORDERS: Sample of orders with table numbers:');
      mongoOrders.slice(0, 10).forEach(order => {
        console.log(`  📋 Order ${order.id}: Table ${order.tableNumber}, Status: ${order.status}`);
      });
      
      // Update local array to keep it in sync with MongoDB
      orders = mongoOrders;
      console.log(`📊 ADMIN ORDERS: Updated local orders array with ${orders.length} total orders`);
    } else {
      mongoOrders = orders || [];
      console.log(`📊 ADMIN ORDERS: Using file storage - ${mongoOrders.length} orders`);
    }
    
    res.render('admin_orders', { orders: mongoOrders || [] });
  } catch (error) {
    console.error('Admin orders error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/clients', authMiddleware, async (req, res) => {
  try {
    let mongoClients;
    
    if (mongoose.connection.readyState === 1) {
      mongoClients = await Client.find().sort({ createdAt: -1 });
    } else {
      mongoClients = clients || [];
    }
    
    res.render('admin_clients', { clients: mongoClients || [] });
  } catch (error) {
    console.error('Admin clients error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/items', authMiddleware, async (req, res) => {
  try {
    let mongoItems, mongoCategories;
    
    if (mongoose.connection.readyState === 1) {
      console.log('🔄 Loading admin items page from MongoDB...');
      mongoItems = await MenuItem.find().sort({ sort_order: 1 });
      mongoCategories = await Category.find().sort({ sort_order: 1 });
      console.log('📊 MongoDB items count:', mongoItems.length);
      console.log('📊 MongoDB categories count:', mongoCategories.length);
    } else {
      console.log('🔄 Loading admin items page from file storage...');
      mongoItems = menuData.items || [];
      mongoCategories = menuData.categories || [];
      console.log('📊 File items count:', mongoItems.length);
      console.log('📊 File categories count:', mongoCategories.length);
    }
    
    if (mongoItems && mongoItems.length > 0) {
      console.log('📋 Sample item:', mongoItems[0]);
      console.log('📋 Sample item category_id:', mongoItems[0].category_id);
    }
    if (mongoCategories && mongoCategories.length > 0) {
      console.log('📋 Sample category:', mongoCategories[0]);
      console.log('📋 Sample category name type:', typeof mongoCategories[0].name);
    }
    
    res.render('admin_items', { 
      items: mongoItems || [],
      categories: mongoCategories || []
    });
  } catch (error) {
    console.error('❌ Admin items error:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/admin/categories', authMiddleware, async (req, res) => {
  try {
    let mongoCategories, mongoItems;
    
    if (mongoose.connection.readyState === 1) {
      mongoCategories = await Category.find().sort({ sort_order: 1 });
      mongoItems = await MenuItem.find().sort({ sort_order: 1 });
    } else {
      mongoCategories = menuData.categories || [];
      mongoItems = menuData.items || [];
    }
    
    res.render('admin_categories', { 
      categories: mongoCategories || [],
      items: mongoItems || []
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

// QR Code Management Page
app.get('/admin/qr', authMiddleware, (req, res) => {
  try {
    res.render('admin_qr', { 
      title: 'QR Code Management',
      menuData: menuData,
      orders: orders,
      clients: clients
    });
  } catch (error) {
    console.error('Error loading QR management page:', error);
    res.status(500).send('Error loading QR management page');
  }
});

// Pending Orders Page - FIXED to use MongoDB
app.get('/admin/orders/pending', authMiddleware, async (req, res) => {
  try {
    let pendingOrders;
    
    if (mongoose.connection.readyState === 1) {
      pendingOrders = await Order.find({ status: 'pending' }).sort({ createdAt: -1 });
      console.log(`📊 ADMIN PENDING: Loaded ${pendingOrders.length} pending orders from MongoDB`);
    } else {
      pendingOrders = orders.filter(o => o.status === 'pending')
        .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
      console.log(`📊 ADMIN PENDING: Using file storage - ${pendingOrders.length} pending orders`);
    }
    
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

// Confirmed Orders Page - FIXED to use MongoDB
app.get('/admin/orders/confirmed', authMiddleware, async (req, res) => {
  try {
    let confirmedOrders;
    
    if (mongoose.connection.readyState === 1) {
      confirmedOrders = await Order.find({ status: 'confirmed' }).sort({ createdAt: -1 });
      console.log(`📊 ADMIN CONFIRMED: Loaded ${confirmedOrders.length} confirmed orders from MongoDB`);
    } else {
      confirmedOrders = orders.filter(o => o.status === 'confirmed')
        .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
      console.log(`📊 ADMIN CONFIRMED: Using file storage - ${confirmedOrders.length} confirmed orders`);
    }
    
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

// Completed Orders Page - FIXED to use MongoDB
app.get('/admin/orders/completed', authMiddleware, async (req, res) => {
  try {
    let completedOrders;
    
    if (mongoose.connection.readyState === 1) {
      completedOrders = await Order.find({ status: 'completed' }).sort({ createdAt: -1 });
      console.log(`📊 ADMIN COMPLETED: Loaded ${completedOrders.length} completed orders from MongoDB`);
    } else {
      completedOrders = orders.filter(o => o.status === 'completed')
        .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
      console.log(`📊 ADMIN COMPLETED: Using file storage - ${completedOrders.length} completed orders`);
    }
    
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

app.get('/admin/sales/completed', authMiddleware, async (req, res) => {
  try {
    const mongoOrders = await Order.find({ status: 'completed' }).sort({ createdAt: -1 });
    const totalSales = mongoOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    res.render('admin_sales_breakdown', {
      title: 'Completed Sales Breakdown',
      period: 'completed',
      orders: mongoOrders,
      stats: {
        total: mongoOrders.length,
        totalValue: totalSales,
        average: mongoOrders.length > 0 ? totalSales / mongoOrders.length : 0
      }
    });
  } catch (error) {
    console.error('Completed sales error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// AGGRESSIVE OVERRIDE SYSTEM - BYPASS ALL EXISTING DATA ISSUES
app.post('/admin/orders/:id/force-edit', authMiddleware, async (req, res) => {
  try {
    console.log('🚨 AGGRESSIVE FORCE EDIT - Order ID:', req.params.id, 'Data:', req.body);
    
    const orderId = parseInt(req.params.id);
    const { status, discount } = req.body;
    
    console.log(`🔥 AGGRESSIVE EDIT: Order ${orderId} -> Status: ${status}, Discount: ${discount}`);
    
    // STEP 1: Find the order in local array
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      console.log(`❌ Order ${orderId} not found in local array`);
      return res.status(404).json({ 
        success: false, 
        error: `Order ${orderId} not found`,
        availableIds: orders.map(o => o.id).slice(0, 5)
      });
    }
    
    const order = orders[orderIndex];
    console.log(`✅ Found order ${orderId} at index ${orderIndex}`);
    console.log(`📝 Order notes BEFORE update:`, order.notes);
    
    // STEP 2: AGGRESSIVE UPDATE - Override everything
    const originalStatus = order.status;
    const originalDiscount = order.discount;
    const originalTotal = order.total;
    
    // Update order properties aggressively
    if (status) {
      order.status = status;
      console.log(`🔥 AGGRESSIVE: Status changed from ${originalStatus} to ${status}`);
    }
    
    if (discount !== undefined) {
      order.discount = parseFloat(discount) || 0;
      
      // Recalculate total aggressively
      const itemsTotal = order.items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
        return sum + itemTotal;
      }, 0);
      
      order.total = Math.max(0, itemsTotal - order.discount);
      console.log(`🔥 AGGRESSIVE: Discount changed from ${originalDiscount} to ${order.discount}, total from ${originalTotal} to ${order.total}`);
    }
    
    order.updatedAt = new Date().toISOString();
    
    // STEP 3: AGGRESSIVE FILE SAVE - Force immediate save
    try {
      saveOrdersData();
      console.log(`🔥 AGGRESSIVE: File save completed immediately`);
    } catch (fileError) {
      console.error(`❌ AGGRESSIVE file save failed:`, fileError);
    }
    
    // STEP 4: AGGRESSIVE MONGODB UPDATE - Delete and recreate to avoid duplicates
    if (mongoose.connection.readyState === 1) {
      try {
        console.log(`🔥 AGGRESSIVE: Deleting ALL duplicates for order ${orderId}`);
        
        // Delete ALL orders with this ID to remove duplicates
        const deleteResult = await Order.deleteMany({ id: orderId });
        console.log(`🔥 AGGRESSIVE: Deleted ${deleteResult.deletedCount} duplicate orders`);
        
        // Create a fresh order with the updated data - PRESERVE ALL FIELDS
        const newOrder = new Order({
          id: orderId,
          status: order.status,
          discount: order.discount,
          total: order.total,
          items: order.items,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          orderType: order.orderType,
          tableNumber: order.tableNumber,
          notes: order.notes || '', // PRESERVE NOTES!
          marketingConsent: order.marketingConsent,
          createdAt: order.createdAt || new Date(),
          updatedAt: new Date()
        });
        
        await newOrder.save();
        console.log(`🔥 AGGRESSIVE: Created fresh order ${orderId} in MongoDB`);
        console.log(`📝 Order notes AFTER MongoDB save:`, newOrder.notes);
        
      } catch (mongoError) {
        console.error(`❌ AGGRESSIVE MongoDB update failed:`, mongoError.message);
      }
    } else {
      console.log(`⚠️ MongoDB not connected, skipping aggressive database update`);
    }
    
    // STEP 5: AGGRESSIVE VERIFICATION
    const updatedOrder = orders.find(o => o.id === orderId);
    console.log(`🔥 AGGRESSIVE VERIFICATION - Order ${orderId}:`, {
      status: updatedOrder.status,
      discount: updatedOrder.discount,
      total: updatedOrder.total,
      updatedAt: updatedOrder.updatedAt
    });
    
    console.log(`🔥 AGGRESSIVE EDIT completed for order ${orderId}`);
    
    res.json({ 
      success: true, 
      message: 'Order AGGRESSIVELY updated - duplicates removed',
      orderId: orderId,
      newStatus: order.status,
      newDiscount: order.discount,
      newTotal: order.total,
      updatedAt: order.updatedAt,
      duplicatesRemoved: true
    });
    
  } catch (error) {
    console.error('❌ Aggressive force edit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// BACKUP: Keep the old route for compatibility
app.post('/admin/orders/:id/simple-edit', authMiddleware, async (req, res) => {
  // Redirect to the force edit route
  req.url = req.url.replace('/simple-edit', '/force-edit');
  return app._router.handle(req, res);
});

// API endpoints for admin
app.get('/admin/api/orders', authMiddleware, (req, res) => {
  res.json(orders);
});

// Admin Bookings Route
app.get('/admin/bookings', authMiddleware, async (req, res) => {
  try {
    console.log('📅 ADMIN BOOKINGS ROUTE CALLED');
    console.log('📊 Local reservations count:', reservations.length);
    console.log('🔗 MongoDB connection state:', mongoose.connection.readyState);
    
    let allReservations;
    
    if (mongoose.connection.readyState === 1) {
      console.log('📅 Loading reservations from MongoDB...');
      allReservations = await Reservation.find().sort({ reservationDate: 1, reservationTime: 1 });
      console.log('📅 MongoDB reservations found:', allReservations.length);
      
      // Update local array with MongoDB data
      reservations = allReservations;
      console.log('📅 Local reservations updated from MongoDB');
    } else {
      console.log('📅 Using local reservations array');
      allReservations = reservations;
    }
    
    console.log('📅 Final reservations to render:', allReservations.length);
    console.log('📅 Sample reservation:', allReservations[0] ? JSON.stringify(allReservations[0], null, 2) : 'No reservations');
    
    res.render('admin_bookings', { 
      reservations: allReservations,
      title: 'Booking Management'
    });
  } catch (error) {
    console.error('❌ Admin bookings error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load bookings' 
    });
  }
});

// AGGRESSIVE STATUS UPDATE SYSTEM - BYPASS DUPLICATES
app.post('/admin/orders/:id/force-status', authMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    console.log(`🔥 AGGRESSIVE STATUS UPDATE - Order ${orderId} to ${status}`);
    
    // STEP 1: Update local array
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      console.log(`❌ Order ${orderId} not found in local array`);
      return res.status(404).json({ 
        success: false, 
        error: `Order ${orderId} not found` 
      });
    }
    
    const originalStatus = orders[orderIndex].status;
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    console.log(`🔥 AGGRESSIVE: Status changed from ${originalStatus} to ${status}`);
    console.log(`📝 Notes preserved in local array:`, orders[orderIndex].notes);
    
    // STEP 2: Force save to file
    try {
      saveOrdersData();
      console.log(`🔥 AGGRESSIVE: File save completed`);
    } catch (fileError) {
      console.error(`❌ AGGRESSIVE file save failed:`, fileError);
    }
    
    // STEP 3: AGGRESSIVE MONGODB UPDATE - Delete and recreate
    if (mongoose.connection.readyState === 1) {
      try {
        console.log(`🔥 AGGRESSIVE: Deleting ALL duplicates for order ${orderId}`);
        
        // Delete ALL orders with this ID to remove duplicates
        const deleteResult = await Order.deleteMany({ id: orderId });
        console.log(`🔥 AGGRESSIVE: Deleted ${deleteResult.deletedCount} duplicate orders`);
        
        // Create a fresh order with the updated status
        const order = orders[orderIndex];
        const newOrder = new Order({
          id: orderId,
          status: status,
          discount: order.discount,
          total: order.total,
          items: order.items,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          orderType: order.orderType,
          tableNumber: order.tableNumber,
          notes: order.notes || '', // Preserve notes!
          marketingConsent: order.marketingConsent,
          createdAt: order.createdAt || new Date(),
          updatedAt: new Date()
        });
        
        await newOrder.save();
        console.log(`🔥 AGGRESSIVE: Created fresh order ${orderId} with status ${status}`);
        
      } catch (mongoError) {
        console.error(`❌ AGGRESSIVE MongoDB status update failed:`, mongoError.message);
      }
    }
    
    console.log(`🔥 AGGRESSIVE STATUS UPDATE completed for order ${orderId}`);
    
    res.json({ 
      success: true, 
      message: 'Order status AGGRESSIVELY updated - duplicates removed',
      orderId: orderId,
      newStatus: status,
      duplicatesRemoved: true
    });
    
  } catch (error) {
    console.error('❌ Aggressive status update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// BACKUP: Keep the old route for compatibility
app.post('/admin/orders/:id/status', authMiddleware, async (req, res) => {
  // Redirect to the force status route
  req.url = req.url.replace('/status', '/force-status');
  return app._router.handle(req, res);
});

// Edit order - NEW SIMPLE VERSION
app.post('/admin/orders/:id/edit', authMiddleware, async (req, res) => {
  try {
    console.log('🚨 ADMIN EDIT ROUTE CALLED - Order ID:', req.params.id, 'Data:', req.body);
    
    const orderId = parseInt(req.params.id);
    const { status, discount } = req.body;
    
    console.log(`🔄 ADMIN EDIT: Updating order ${orderId} with status: ${status}, discount: ${discount}`);
    
    // Try MongoDB first
    if (mongoose.connection.readyState === 1) {
      const order = await Order.findOne({ id: orderId });
      if (order) {
        // Update status if provided
        if (status) order.status = status;
        
        // Update discount if provided
        if (discount !== undefined) {
          order.discount = parseFloat(discount) || 0;
          
          // Recalculate total if discount changed
          const itemsTotal = order.items.reduce((sum, item) => {
            const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
            return sum + itemTotal;
          }, 0);
          
          const discountAmount = parseFloat(discount) || 0;
          const finalTotal = Math.max(0, itemsTotal - discountAmount);
          order.total = finalTotal;
          
          console.log(`📊 Recalculated total: ${itemsTotal} - ${discountAmount} = ${finalTotal}`);
        }
        
        order.updatedAt = new Date();
        await order.save();
        
        console.log(`✅ Admin order edited in MongoDB: ${orderId}`);
        
        // Also update the local orders array to keep it in sync
        const localOrderIndex = orders.findIndex(o => o.id === orderId);
        if (localOrderIndex !== -1) {
          if (status) orders[localOrderIndex].status = status;
          if (discount !== undefined) {
            orders[localOrderIndex].discount = parseFloat(discount) || 0;
            // Recalculate total for local array too
            const itemsTotal = orders[localOrderIndex].items.reduce((sum, item) => {
              const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
              return sum + itemTotal;
            }, 0);
            const discountAmount = parseFloat(discount) || 0;
            const finalTotal = Math.max(0, itemsTotal - discountAmount);
            orders[localOrderIndex].total = finalTotal;
          }
          orders[localOrderIndex].updatedAt = new Date().toISOString();
          console.log(`✅ Local orders array also updated: ${orderId}`);
        }
        
        return res.json({ 
          success: true, 
          order: order,
          message: 'Order updated successfully in MongoDB'
        });
      } else {
        console.log(`⚠️ Order ${orderId} not found in MongoDB, trying file storage...`);
      }
    } else {
      console.log('⚠️ MongoDB not connected, using file storage...');
    }
    
    // Fallback to file storage
    const ordersWithId = orders.filter(o => o.id === orderId);
    if (ordersWithId.length === 0) {
      console.log('❌ Order not found in file storage either');
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Handle duplicates by finding the most recent one
    if (ordersWithId.length > 1) {
      console.log(`⚠️ WARNING: Found ${ordersWithId.length} orders with ID ${orderId}. Using the most recent one.`);
    }
    
    // Sort by creation date and get the most recent one
    const sortedOrders = ordersWithId.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.timestamp || 0);
      const dateB = new Date(b.createdAt || b.timestamp || 0);
      return dateB - dateA; // Most recent first
    });
    
    const mostRecentOrder = sortedOrders[0];
    const orderIndex = orders.findIndex(o => o === mostRecentOrder);
    
    // Update only status and discount
    if (status) orders[orderIndex].status = status;
    if (discount !== undefined) orders[orderIndex].discount = parseFloat(discount) || 0;
    
    // Recalculate total if discount changed
    if (discount !== undefined) {
      const itemsTotal = orders[orderIndex].items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
        return sum + itemTotal;
      }, 0);
      
      const discountAmount = parseFloat(discount) || 0;
      const finalTotal = Math.max(0, itemsTotal - discountAmount);
      
      console.log(`📊 Recalculated total: ${itemsTotal} - ${discountAmount} = ${finalTotal}`);
      orders[orderIndex].total = finalTotal;
    }
    
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    console.log(`✅ Admin order edited in file storage: ${orderId}`);
    
    // Save to file
    saveOrdersData();
    console.log('📁 File saved');
    
    // Return success
    res.json({ 
      success: true, 
      order: orders[orderIndex],
      message: 'Order updated successfully in file storage'
    });
    
  } catch (error) {
    console.error('❌ Admin edit error:', error);
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
app.get('/kitchen', kitchenAuthMiddleware, async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    console.log(`🍳 KITCHEN DASHBOARD: Filtering for ${startOfDay.toDateString()}`);
    
    let todayOrders;
    
    if (mongoose.connection.readyState === 1) {
      // Get today's orders from MongoDB (excluding cancelled)
      todayOrders = await Order.find({ 
        status: { $ne: 'cancelled' },
        createdAt: {
          $gte: startOfDay,
          $lt: endOfDay
        }
      }).sort({ createdAt: -1 });
      
      console.log(`🍳 KITCHEN DASHBOARD: Found ${todayOrders.length} orders for today`);
      
      // Log table numbers for debugging
      todayOrders.forEach(order => {
        console.log(`  📋 Order ${order.id}: Table ${order.tableNumber}, Status: ${order.status}`);
      });
      
      // Update local orders array with all orders
      orders = await Order.find().sort({ createdAt: -1 });
    } else {
      // Use file-based data as fallback - filter for today
      todayOrders = orders.filter(order => {
        const orderDate = new Date(order.createdAt || order.timestamp);
        return orderDate >= startOfDay && orderDate < endOfDay && order.status !== 'cancelled';
      });
      console.log(`🍳 KITCHEN DASHBOARD: Using file storage - ${todayOrders.length} orders for today`);
    }
    
    const pendingOrders = todayOrders.filter(o => o.status === 'pending');
    const confirmedOrders = todayOrders.filter(o => o.status === 'confirmed');
    
    res.render('kitchen_dashboard', {
      pendingOrders,
      confirmedOrders,
      totalOrders: todayOrders.length,
      orders: todayOrders,
      dateFilter: 'today'
    });
  } catch (error) {
    console.error('Kitchen dashboard error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/kitchen/orders', kitchenAuthMiddleware, async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    console.log(`🍳 KITCHEN DAILY ORDERS: Filtering for ${startOfDay.toDateString()}`);
    
    let todayOrders;
    
    if (mongoose.connection.readyState === 1) {
      // Get only today's orders from MongoDB
      todayOrders = await Order.find({
        createdAt: {
          $gte: startOfDay,
          $lt: endOfDay
        }
      }).sort({ createdAt: -1 });
      
      console.log(`🍳 KITCHEN DAILY: Found ${todayOrders.length} orders for today`);
      
      // Log table numbers for debugging
      todayOrders.forEach(order => {
        console.log(`  📋 Order ${order.id}: Table ${order.tableNumber}, Status: ${order.status}`);
      });
      
      // Update local array to keep it in sync with MongoDB
      orders = await Order.find().sort({ createdAt: -1 });
      console.log(`🍳 KITCHEN DAILY: Updated local orders array with ${orders.length} total orders`);
    } else {
      // Use file-based data as fallback - filter for today
      todayOrders = orders.filter(order => {
        const orderDate = new Date(order.createdAt || order.timestamp);
        return orderDate >= startOfDay && orderDate < endOfDay;
      });
      console.log(`🍳 KITCHEN DAILY: Using file storage - ${todayOrders.length} orders for today`);
    }
    
    res.render('kitchen_orders', { 
      orders: todayOrders,
      title: 'Kitchen Orders - Today',
      dateFilter: 'today',
      totalOrders: todayOrders.length,
      dateRange: {
        start: startOfDay.toDateString(),
        end: endOfDay.toDateString()
      }
    });
  } catch (error) {
    console.error('Kitchen daily orders error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load daily orders' 
    });
  }
});

// KITCHEN ALL ORDERS - For viewing all orders (not just today)
app.get('/kitchen/orders/all', kitchenAuthMiddleware, async (req, res) => {
  try {
    let allOrders;
    
    if (mongoose.connection.readyState === 1) {
      // Get all orders from MongoDB
      allOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`🍳 KITCHEN ALL ORDERS: Loaded ${allOrders.length} orders from MongoDB`);
    } else {
      // Use file-based data as fallback
      allOrders = orders;
      console.log(`🍳 KITCHEN ALL ORDERS: Using file storage - ${allOrders.length} orders`);
    }
    
    res.render('kitchen_orders', { 
      orders: allOrders,
      title: 'Kitchen Orders - All Time',
      dateFilter: 'all',
      totalOrders: allOrders.length
    });
  } catch (error) {
    console.error('Kitchen all orders error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load all orders' 
    });
  }
});

// KITCHEN ORDERS API - For JSON data requests
app.get('/kitchen/api/orders', kitchenAuthMiddleware, async (req, res) => {
  try {
    let allOrders;
    
    if (mongoose.connection.readyState === 1) {
      // Get all orders from MongoDB
      allOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`🍳 KITCHEN API: Loaded ${allOrders.length} orders from MongoDB`);
    } else {
      // Use file-based data as fallback
      allOrders = orders;
      console.log(`🍳 KITCHEN API: Using file storage - ${allOrders.length} orders`);
    }
    
    res.json({ 
      success: true, 
      orders: allOrders 
    });
  } catch (error) {
    console.error('Kitchen API orders error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load orders' 
    });
  }
});

// AGGRESSIVE KITCHEN STATUS UPDATE SYSTEM - BYPASS DUPLICATES
app.post('/kitchen/orders/:id/force-status', kitchenAuthMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    console.log(`🔥 KITCHEN AGGRESSIVE STATUS UPDATE - Order ${orderId} to ${status}`);
    
    // STEP 1: Update local array
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      console.log(`❌ Kitchen order ${orderId} not found in local array`);
      return res.status(404).json({ 
        success: false, 
        error: `Kitchen order ${orderId} not found` 
      });
    }
    
    const originalStatus = orders[orderIndex].status;
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    console.log(`🔥 KITCHEN AGGRESSIVE: Status changed from ${originalStatus} to ${status}`);
    console.log(`📝 Notes preserved in local array:`, orders[orderIndex].notes);
    
    // STEP 2: Force save to file
    try {
      saveOrdersData();
      console.log(`🔥 KITCHEN AGGRESSIVE: File save completed`);
    } catch (fileError) {
      console.error(`❌ Kitchen AGGRESSIVE file save failed:`, fileError);
    }
    
    // STEP 3: AGGRESSIVE MONGODB UPDATE - Delete and recreate
    if (mongoose.connection.readyState === 1) {
      try {
        console.log(`🔥 KITCHEN AGGRESSIVE: Deleting ALL duplicates for order ${orderId}`);
        
        // Delete ALL orders with this ID to remove duplicates
        const deleteResult = await Order.deleteMany({ id: orderId });
        console.log(`🔥 KITCHEN AGGRESSIVE: Deleted ${deleteResult.deletedCount} duplicate orders`);
        
        // Create a fresh order with the updated status
        const order = orders[orderIndex];
        const newOrder = new Order({
          id: orderId,
          status: status,
          discount: order.discount,
          total: order.total,
          items: order.items,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          orderType: order.orderType,
          tableNumber: order.tableNumber,
          notes: order.notes || '', // Preserve notes!
          marketingConsent: order.marketingConsent,
          createdAt: order.createdAt || new Date(),
          updatedAt: new Date()
        });
        
        await newOrder.save();
        console.log(`🔥 KITCHEN AGGRESSIVE: Created fresh order ${orderId} with status ${status}`);
        
      } catch (mongoError) {
        console.error(`❌ Kitchen AGGRESSIVE MongoDB status update failed:`, mongoError.message);
      }
    }
    
    console.log(`🔥 KITCHEN AGGRESSIVE STATUS UPDATE completed for order ${orderId}`);
    
    res.json({ 
      success: true, 
      message: 'Kitchen order status AGGRESSIVELY updated - duplicates removed',
      orderId: orderId,
      newStatus: status,
      duplicatesRemoved: true
    });
    
  } catch (error) {
    console.error('❌ Kitchen aggressive status update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// BACKUP: Keep the old route for compatibility
app.post('/kitchen/orders/:id/status', kitchenAuthMiddleware, async (req, res) => {
  // Redirect to the force status route
  req.url = req.url.replace('/status', '/force-status');
  return app._router.handle(req, res);
});


// Health check
// COMPREHENSIVE DUPLICATE CLEANUP SYSTEM
app.post('/admin/aggressive-cleanup', authMiddleware, async (req, res) => {
  try {
    console.log('🔥 COMPREHENSIVE DUPLICATE CLEANUP INITIATED');
    
    if (mongoose.connection.readyState === 1) {
      // Get all orders and find duplicates
      const allOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`🔥 Found ${allOrders.length} total orders in MongoDB`);
      
      // Group orders by ID
      const orderGroups = {};
      allOrders.forEach(order => {
        if (!orderGroups[order.id]) {
          orderGroups[order.id] = [];
        }
        orderGroups[order.id].push(order);
      });
      
      // Find and clean duplicates
      let totalDeleted = 0;
      const cleanedOrders = [];
      const duplicateDetails = {};
      
      for (const [orderId, orderList] of Object.entries(orderGroups)) {
        if (orderList.length > 1) {
          console.log(`🔥 Cleaning order ID ${orderId}: ${orderList.length} duplicates found`);
          
          // Keep the most recent one, delete the rest
          const sortedOrders = orderList.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
          const keepOrder = sortedOrders[0];
          const deleteOrders = sortedOrders.slice(1);
          
          duplicateDetails[orderId] = {
            totalFound: orderList.length,
            kept: keepOrder._id,
            deleted: deleteOrders.map(o => o._id)
          };
          
          // Delete duplicates
          for (const deleteOrder of deleteOrders) {
            await Order.findByIdAndDelete(deleteOrder._id);
            totalDeleted++;
          }
          
          cleanedOrders.push(keepOrder);
          console.log(`🔥 Kept most recent order ${orderId}, deleted ${deleteOrders.length} duplicates`);
        } else {
          cleanedOrders.push(orderList[0]);
        }
      }
      
      // Update local array with cleaned data
      orders.length = 0;
      orders.push(...cleanedOrders);
      
      // Force save to file
      saveOrdersData();
      
      console.log(`🔥 COMPREHENSIVE CLEANUP completed: Deleted ${totalDeleted} duplicates, kept ${cleanedOrders.length} unique orders`);
      
      res.json({
        success: true,
        message: 'Comprehensive duplicate cleanup completed',
        duplicatesDeleted: totalDeleted,
        uniqueOrders: cleanedOrders.length,
        totalOrders: orders.length,
        duplicateDetails: duplicateDetails
      });
    } else {
      console.log('⚠️ MongoDB not connected, cannot perform comprehensive cleanup');
      res.json({
        success: false,
        message: 'MongoDB not connected, cannot perform comprehensive cleanup'
      });
    }
  } catch (error) {
    console.error('❌ Comprehensive cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// FORCE DATA OVERRIDE SYSTEM
app.post('/admin/force-sync', authMiddleware, async (req, res) => {
  try {
    console.log('🚨 FORCE DATA SYNC INITIATED');
    
    if (mongoose.connection.readyState === 1) {
      // Force reload all data from MongoDB
      const mongoOrders = await Order.find().sort({ createdAt: -1 });
      const mongoCategories = await Category.find().sort({ sort_order: 1 });
      const mongoItems = await MenuItem.find();
      
      // Override local arrays completely
      orders.length = 0;
      orders.push(...mongoOrders);
      
      menuData.categories = mongoCategories;
      menuData.items = mongoItems;
      
      console.log(`✅ FORCE SYNC completed: ${orders.length} orders, ${mongoCategories.length} categories, ${mongoItems.length} items`);
      
      res.json({
        success: true,
        message: 'Data force sync completed',
        ordersCount: orders.length,
        categoriesCount: mongoCategories.length,
        itemsCount: mongoItems.length
      });
    } else {
      console.log('⚠️ MongoDB not connected, cannot force sync');
      res.json({
        success: false,
        message: 'MongoDB not connected, cannot force sync'
      });
    }
  } catch (error) {
    console.error('❌ Force sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// FORCE ORDER RELOAD - Reload specific order from MongoDB
app.post('/admin/orders/:id/force-reload', authMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`🚨 FORCE RELOAD ORDER ${orderId}`);
    
    if (mongoose.connection.readyState === 1) {
      const mongoOrder = await Order.findOne({ id: orderId });
      
      if (mongoOrder) {
        // Find and replace the order in local array
        const localIndex = orders.findIndex(o => o.id === orderId);
        if (localIndex !== -1) {
          orders[localIndex] = mongoOrder;
          console.log(`✅ Order ${orderId} force reloaded from MongoDB`);
        } else {
          orders.push(mongoOrder);
          console.log(`✅ Order ${orderId} added to local array from MongoDB`);
        }
        
        res.json({
          success: true,
          message: `Order ${orderId} force reloaded`,
          order: mongoOrder
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Order ${orderId} not found in MongoDB`
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: 'MongoDB not connected'
      });
    }
  } catch (error) {
    console.error('❌ Force reload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DEBUG ROUTE - Check order creation and data flow
// Debug route for clients
app.get('/debug/clients', async (req, res) => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      localClients: {
        count: clients.length,
        all: clients,
        emails: clients.map(c => c.email)
      },
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      }
    };

    // If MongoDB is connected, also check MongoDB data
    if (mongoose.connection.readyState === 1) {
      try {
        const mongoClients = await Client.find().sort({ createdAt: -1 });
        debugInfo.mongoClients = {
          count: mongoClients.length,
          all: mongoClients,
          emails: mongoClients.map(c => c.email)
        };
      } catch (error) {
        debugInfo.mongoError = error.message;
      }
    }
    
    res.json(debugInfo);
  } catch (error) {
    console.error('Debug clients error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug/orders', (req, res) => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      localOrders: {
        count: orders.length,
        latest: orders.slice(-3), // Last 3 orders
        ids: orders.map(o => o.id)
      },
      orderIdCounter: orderIdCounter,
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      }
    };

    // If MongoDB is connected, also check MongoDB data
    if (mongoose.connection.readyState === 1) {
      Order.find().sort({ createdAt: -1 }).limit(5).then(mongoOrders => {
        debugInfo.mongoOrders = {
          count: mongoOrders.length,
          latest: mongoOrders.slice(0, 3),
          ids: mongoOrders.map(o => o.id)
        };
        res.json(debugInfo);
      }).catch(error => {
        debugInfo.mongoError = error.message;
        res.json(debugInfo);
      });
    } else {
      res.json(debugInfo);
    }
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// CRITICAL ORDERS DEBUG ROUTE - Show complete orders state
app.get('/debug/orders-state', async (req, res) => {
  try {
    console.log('🔍 CRITICAL ORDERS STATE DEBUG...');
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      localOrders: {
        count: orders.length,
        array: orders,
        ids: orders.map(o => o.id),
        latest: orders.slice(-3)
      },
      orderIdCounter: orderIdCounter,
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      }
    };
    
    // Get MongoDB data if connected
    if (mongoose.connection.readyState === 1) {
      try {
        const mongoOrders = await Order.find().sort({ createdAt: -1 });
        debugInfo.mongoOrders = {
          count: mongoOrders.length,
          ids: mongoOrders.map(o => o.id),
          latest: mongoOrders.slice(0, 3)
        };
        console.log(`🔍 MongoDB has ${mongoOrders.length} orders`);
      } catch (mongoError) {
        debugInfo.mongoError = mongoError.message;
        console.error('❌ MongoDB query error:', mongoError);
      }
    }
    
    console.log('📊 Debug info:', JSON.stringify(debugInfo, null, 2));
    res.json(debugInfo);
  } catch (error) {
    console.error('❌ Critical orders debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// DEBUG ALL ORDERS ROUTE - Show all orders regardless of date filter
app.get('/debug/all-orders', async (req, res) => {
  try {
    let allOrders;
    
    if (mongoose.connection.readyState === 1) {
      allOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`🔍 DEBUG ALL ORDERS: Found ${allOrders.length} orders in MongoDB`);
    } else {
      allOrders = orders;
      console.log(`🔍 DEBUG ALL ORDERS: Found ${allOrders.length} orders in local array`);
    }
    
    res.json({
      success: true,
      totalOrders: allOrders.length,
      orders: allOrders,
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Debug all orders error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// CRITICAL FIX ROUTE - Force complete data reload and sync
app.get('/debug/force-sync', async (req, res) => {
  try {
    console.log('🚨 CRITICAL FIX: Force complete data sync...');
    
    // Step 1: Reload from MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      console.log('🗄️ MongoDB connected, reloading from database...');
      const mongoOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`📊 Found ${mongoOrders.length} orders in MongoDB`);
      
      // Clear local array and reload
      orders.length = 0;
      orders.push(...mongoOrders);
      
      // Update order ID counter
      orderIdCounter = mongoOrders.length > 0 ? Math.max(...orders.map(o => o.id), 0) + 1 : 1;
      
      console.log(`✅ MongoDB sync: ${orders.length} orders loaded, next ID: ${orderIdCounter}`);
    } else {
      console.log('⚠️ MongoDB not connected, using file storage...');
    }
    
    // Step 2: Force save to files
    console.log('💾 Force saving to files...');
    saveOrdersData();
    console.log('✅ File save completed');
    
    // Step 3: Verify data integrity
    console.log('🔍 Verifying data integrity...');
    const verification = {
      ordersCount: orders.length,
      orderIds: orders.map(o => o.id),
      nextOrderId: orderIdCounter,
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      }
    };
    
    console.log('📊 Verification results:', verification);
    
    res.json({
      success: true,
      message: 'Critical data sync completed',
      verification: verification,
      latestOrders: orders.slice(0, 5)
    });
  } catch (error) {
    console.error('❌ Critical sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// FORCE REFRESH ROUTE - Reload all data from MongoDB
app.get('/debug/refresh', async (req, res) => {
  try {
    console.log('🔄 FORCE REFRESH: Reloading all data...');
    
    if (mongoose.connection.readyState === 1) {
      // Reload orders from MongoDB
      const mongoOrders = await Order.find().sort({ createdAt: -1 });
      orders.length = 0;
      orders.push(...mongoOrders);
      
      // Update order ID counter
      orderIdCounter = mongoOrders.length > 0 ? Math.max(...orders.map(o => o.id), 0) + 1 : 1;
      
      // Save to files
      saveOrdersData();
      
      console.log(`✅ FORCE REFRESH: Loaded ${orders.length} orders, next ID: ${orderIdCounter}`);
      
      res.json({
        success: true,
        message: 'Data refreshed successfully',
        ordersCount: orders.length,
        nextOrderId: orderIdCounter,
        latestOrders: orders.slice(0, 3)
      });
    } else {
      res.json({
        success: false,
        message: 'MongoDB not connected',
        ordersCount: orders.length
      });
    }
  } catch (error) {
    console.error('❌ Force refresh error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// RESERVATION SYSTEM ROUTES

// Customer-facing booking page (QR code destination)
app.get('/book', (req, res) => {
  res.render('customer_booking', {
    title: 'Book Your Table - AROMA Restaurant'
  });
});

// Admin booking management page (separate from customer booking)
app.get('/booking', (req, res) => {
  res.render('booking', { title: 'Table Reservation' });
});

// Create new reservation
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('📅 RESERVATION CREATION STARTED');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📊 Current reservations count before:', reservations.length);
    console.log('🔢 Current reservationIdCounter:', reservationIdCounter);
    
    const { 
      customerName, 
      customerEmail, 
      customerPhone, 
      partySize, 
      reservationDate, 
      reservationTime, 
      specialRequests, 
      marketingConsent 
    } = req.body;
    
    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !partySize || !reservationDate || !reservationTime) {
      return res.status(400).json({ 
        success: false, 
        error: 'All required fields must be provided' 
      });
    }
    
    // Check if date is in the future
    const reservationDateTime = new Date(`${reservationDate}T${reservationTime}`);
    if (reservationDateTime <= new Date()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Reservation must be for a future date and time' 
      });
    }
    
    // Check availability
    console.log('🔍 Checking availability for:', reservationDate, reservationTime);
    const availability = await checkAvailability(reservationDate, reservationTime);
    console.log('🔍 Availability check result:', availability);
    
    if (!availability.available) {
      console.log('❌ Availability check failed:', availability.reason);
      return res.status(400).json({ 
        success: false, 
        error: availability.reason || 'No availability for selected date and time' 
      });
    }
    
    console.log('✅ Availability check passed');
    
    const newReservation = {
      id: reservationIdCounter++,
      customerName,
      customerEmail,
      customerPhone,
      partySize: parseInt(partySize),
      reservationDate: new Date(reservationDate),
      reservationTime,
      status: 'pending',
      specialRequests: specialRequests || '',
      marketingConsent: marketingConsent === true,
      tableNumber: null,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log('🆕 New reservation created:', JSON.stringify(newReservation, null, 2));
    
    // Add to local array
    reservations.push(newReservation);
    console.log('📊 Reservations count after adding:', reservations.length);
    console.log('🔢 Next reservationIdCounter:', reservationIdCounter);
    
    // Save to MongoDB if connected
    try {
      if (mongoose.connection.readyState === 1) {
        const reservationDoc = new Reservation(newReservation);
        await reservationDoc.save();
        console.log(`✅ Reservation ${newReservation.id} saved to MongoDB`);
      }
    } catch (mongoError) {
      console.error('❌ MongoDB save error:', mongoError);
    }
    
    // Save to files
    saveReservationsData();
    
    // Save client if marketing consent is given
    console.log('📊 Marketing consent value:', marketingConsent);
    console.log('📊 Current clients count:', clients.length);
    
    if (marketingConsent) {
      try {
        console.log('✅ Marketing consent given, proceeding to save client...');
        
        // Check if client exists in MongoDB first, then local array
        let existingClient = null;
        if (mongoose.connection.readyState === 1) {
          existingClient = await Client.findOne({ email: customerEmail });
          console.log('🔍 MongoDB check - existing client:', existingClient ? 'Found' : 'Not found');
        }
        
        if (!existingClient) {
          existingClient = clients.find(c => c.email === customerEmail);
          console.log('🔍 Local array check - existing client:', existingClient ? 'Found' : 'Not found');
        }
        
        if (!existingClient) {
          const newClient = {
            id: clients.length > 0 ? Math.max(...clients.map(c => c.id)) + 1 : 1,
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            marketingConsent: true,
            totalOrders: 0,
            totalSpent: 0,
            totalReservations: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          console.log('🆕 Creating new client:', JSON.stringify(newClient, null, 2));
          
          // Add to local array first
          clients.push(newClient);
          console.log('✅ Added to local clients array, new count:', clients.length);
          
          // Save to MongoDB
          if (mongoose.connection.readyState === 1) {
            try {
              const clientDoc = await Client.create(newClient);
              console.log('✅ Client saved to MongoDB:', clientDoc._id);
            } catch (mongoErr) {
              console.error('❌ MongoDB save error:', mongoErr);
            }
          }
          
          // Save to file
          saveClientsData();
          console.log('✅ Clients data saved to file');
          console.log('✅ NEW CLIENT CREATED SUCCESSFULLY FROM RESERVATION');
        } else {
          console.log('ℹ️ Client already exists, updating...');
          // Update existing client's reservation count
          if (existingClient._id) {
            // MongoDB object
            await Client.findByIdAndUpdate(existingClient._id, {
              $inc: { totalReservations: 1 },
              updatedAt: new Date()
            });
            console.log('✅ Updated client in MongoDB');
          } else {
            // Local array object
            existingClient.totalReservations = (existingClient.totalReservations || 0) + 1;
            existingClient.updatedAt = new Date().toISOString();
            console.log('✅ Updated client in local array');
          }
          
          saveClientsData();
          console.log('✅ Updated existing client reservation count');
        }
      } catch (clientError) {
        console.error('❌ CLIENT SAVE ERROR:', clientError);
        console.error('❌ Error stack:', clientError.stack);
      }
    } else {
      console.log('⚠️ Marketing consent NOT given, skipping client save');
    }
    
    console.log('✅ RESERVATION CREATION COMPLETED');
    
    // Send email confirmation
    try {
      const emailResult = await sendReservationConfirmation(newReservation);
      console.log('📧 Email confirmation result:', emailResult);
    } catch (emailError) {
      console.error('❌ Email confirmation failed:', emailError);
      // Don't fail the reservation if email fails
    }
    
    res.json({ 
      success: true, 
      reservation: newReservation,
      message: 'Reservation created successfully'
    });
  } catch (error) {
    console.error('❌ Reservation creation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create reservation' 
    });
  }
});

// Get all reservations
app.get('/api/reservations', async (req, res) => {
  try {
    let allReservations;
    
    if (mongoose.connection.readyState === 1) {
      allReservations = await Reservation.find().sort({ reservationDate: 1, reservationTime: 1 });
    } else {
      allReservations = reservations;
    }
    
    res.json({
      success: true,
      reservations: allReservations
    });
  } catch (error) {
    console.error('Error fetching reservations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reservations'
    });
  }
});

// Update reservation status
app.post('/api/reservations/:id/status', async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id);
    const { status } = req.body;
    
    // Update local array
    const reservationIndex = reservations.findIndex(r => r.id === reservationId);
    if (reservationIndex !== -1) {
      reservations[reservationIndex].status = status;
      reservations[reservationIndex].updatedAt = new Date().toISOString();
    }
    
    // Update MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      await Reservation.findOneAndUpdate(
        { id: reservationId },
        { status, updatedAt: new Date() }
      );
    }
    
    // Save to files
    saveReservationsData();
    
    res.json({
      success: true,
      message: 'Reservation status updated'
    });
  } catch (error) {
    console.error('Error updating reservation status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reservation status'
    });
  }
});

// Update reservation
app.put('/api/reservations/:id', async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id);
    const updateData = req.body;
    
    // Update local array
    const reservationIndex = reservations.findIndex(r => r.id === reservationId);
    if (reservationIndex !== -1) {
      reservations[reservationIndex] = { ...reservations[reservationIndex], ...updateData };
      reservations[reservationIndex].updatedAt = new Date().toISOString();
    }
    
    // Update MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      await Reservation.findOneAndUpdate(
        { id: reservationId },
        { ...updateData, updatedAt: new Date() }
      );
    }
    
    // Save to files
    saveReservationsData();
    
    res.json({
      success: true,
      message: 'Reservation updated'
    });
  } catch (error) {
    console.error('Error updating reservation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reservation'
    });
  }
});

// Update availability
app.post('/api/availability', async (req, res) => {
  try {
    const { date, isAvailable, openTime, closeTime, maxReservations, blockedReasons } = req.body;
    
    const availabilityData = {
      date: new Date(date),
      isAvailable,
      openTime,
      closeTime,
      maxReservations: parseInt(maxReservations),
      blockedReasons: blockedReasons || '',
      updatedAt: new Date()
    };
    
    // Update local array
    const existingIndex = availability.findIndex(a => 
      new Date(a.date).toDateString() === new Date(date).toDateString()
    );
    
    if (existingIndex !== -1) {
      availability[existingIndex] = availabilityData;
    } else {
      availability.push(availabilityData);
    }
    
    // Update MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      await Availability.findOneAndUpdate(
        { date: new Date(date) },
        availabilityData,
        { upsert: true }
      );
    }
    
    // Save to files
    saveAvailabilityData();
    
    res.json({
      success: true,
      message: 'Availability updated'
    });
  } catch (error) {
    console.error('Error updating availability:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update availability'
    });
  }
});

// Get blocked days
app.get('/api/availability/blocked', async (req, res) => {
  try {
    let blockedDays;
    
    if (mongoose.connection.readyState === 1) {
      blockedDays = await Availability.find({ isAvailable: false }).sort({ date: 1 });
    } else {
      blockedDays = availability.filter(a => !a.isAvailable);
    }
    
    res.json({
      success: true,
      blockedDays: blockedDays.map(day => ({
        date: day.date,
        reason: day.blockedReasons || ''
      }))
    });
  } catch (error) {
    console.error('Error fetching blocked days:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch blocked days'
    });
  }
});

// Block or unblock a specific day
app.post('/api/availability/block', async (req, res) => {
  try {
    const { date, isBlocked, reason } = req.body;
    
    console.log('📅 Block/Unblock request:', { date, isBlocked, reason });
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required'
      });
    }
    
    // Parse date as local date to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    console.log('📅 Parsed date:', localDate.toISOString());
    
    const availabilityData = {
      date: localDate,
      isAvailable: !isBlocked,
      blockedReasons: reason || '',
      openTime: '12:00',
      closeTime: '23:00',
      maxReservations: 50,
      updatedAt: new Date()
    };
    
    // Update local array - use date string comparison
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existingIndex = availability.findIndex(a => {
      const aDate = new Date(a.date);
      const aDateStr = `${aDate.getFullYear()}-${String(aDate.getMonth() + 1).padStart(2, '0')}-${String(aDate.getDate()).padStart(2, '0')}`;
      return aDateStr === dateStr;
    });
    
    if (isBlocked) {
      // Block the day
      if (existingIndex !== -1) {
        availability[existingIndex] = availabilityData;
        console.log('✅ Updated existing blocked day');
      } else {
        availability.push(availabilityData);
        console.log('✅ Added new blocked day');
      }
    } else {
      // Unblock the day - remove from array
      if (existingIndex !== -1) {
        availability.splice(existingIndex, 1);
        console.log('✅ Removed blocked day from local array');
      } else {
        console.log('⚠️ Day not found in local array');
      }
    }
    
    // Update MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      if (isBlocked) {
        await Availability.findOneAndUpdate(
          { date: localDate },
          availabilityData,
          { upsert: true }
        );
        console.log('✅ Blocked day in MongoDB');
      } else {
        // Delete by date range to handle timezone differences
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
        const result = await Availability.deleteMany({
          date: { $gte: startOfDay, $lte: endOfDay }
        });
        console.log('✅ Unblocked day in MongoDB, deleted:', result.deletedCount);
      }
    }
    
    // Save to files
    saveAvailabilityData();
    
    res.json({
      success: true,
      message: isBlocked ? 'Day blocked successfully' : 'Day unblocked successfully'
    });
  } catch (error) {
    console.error('❌ Error blocking/unblocking day:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to block/unblock day'
    });
  }
});

// QR Code Generation for Bookings
app.post('/api/qr/generate-booking', async (req, res) => {
  try {
    const { url, title, description } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL is required' 
      });
    }
    
    console.log('🔗 Generating booking QR code for:', url);
    
    // Generate QR code
    const qrCodeDataURL = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    console.log('✅ Booking QR code generated successfully');
    
    res.json({
      success: true,
      qrCode: qrCodeDataURL,
      url: url,
      title: title || 'Book Your Table',
      description: description || ''
    });
  } catch (error) {
    console.error('❌ Error generating booking QR code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate booking QR code'
    });
  }
});

// Email confirmation function for reservations
async function sendReservationConfirmation(reservation) {
  try {
    console.log('📧 SendGrid API Key configured:', !!SENDGRID_API_KEY);
    console.log('📧 API Key length:', SENDGRID_API_KEY ? SENDGRID_API_KEY.length : 0);
    
    if (!SENDGRID_API_KEY) {
      console.log('⚠️ SendGrid API key not configured - skipping email send');
      return { success: false, message: 'SendGrid API key not configured' };
    }

    const formattedDate = new Date(reservation.reservationDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const msg = {
      to: reservation.customerEmail,
      from: EMAIL_FROM,
      subject: `Reservation Confirmation - ${RESTAURANT_NAME}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">🍽️ ${RESTAURANT_NAME}</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Reservation Confirmation</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #2d3748; margin-top: 0;">Hello ${reservation.customerName}!</h2>
            
            <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
              Thank you for choosing ${RESTAURANT_NAME}! Your table reservation has been confirmed.
            </p>
            
            <div style="background: white; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h3 style="color: #2d3748; margin-top: 0;">📅 Reservation Details</h3>
              
              <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                <strong>Date:</strong>
                <span style="color: #4a5568;">${formattedDate}</span>
              </div>
              
              <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                <strong>Time:</strong>
                <span style="color: #4a5568;">${reservation.reservationTime}</span>
              </div>
              
              <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                <strong>Party Size:</strong>
                <span style="color: #4a5568;">${reservation.partySize} people</span>
              </div>
              
              ${reservation.tableNumber ? `
              <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                <strong>Table:</strong>
                <span style="color: #4a5568;">Table ${reservation.tableNumber}</span>
              </div>
              ` : ''}
              
              ${reservation.specialRequests ? `
              <div style="padding: 10px 0;">
                <strong>Special Requests:</strong>
                <div style="color: #4a5568; margin-top: 5px; font-style: italic;">${reservation.specialRequests}</div>
              </div>
              ` : ''}
            </div>
            
            <div style="background: #e8f5e8; border: 2px solid #4caf50; border-radius: 10px; padding: 15px; margin: 20px 0;">
              <h4 style="color: #2e7d32; margin: 0 0 10px 0;">✅ Status: Confirmed</h4>
              <p style="color: #388e3c; margin: 0; font-size: 14px;">
                We look forward to serving you! Please arrive 10 minutes before your reservation time.
              </p>
            </div>
            
            <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <h4 style="color: #0c4a6e; margin: 0 0 10px 0;">📍 Restaurant Information</h4>
              <p style="color: #0c4a6e; margin: 5px 0;"><strong>Address:</strong> 123 Restaurant Street, City</p>
              <p style="color: #0c4a6e; margin: 5px 0;"><strong>Phone:</strong> (555) 123-4567</p>
              <p style="color: #0c4a6e; margin: 5px 0;"><strong>Hours:</strong> Mon-Sun: 11:00 AM - 10:00 PM</p>
            </div>
            
            <p style="color: #4a5568; font-size: 14px; margin-top: 30px;">
              If you need to modify or cancel your reservation, please contact us at least 2 hours in advance.
            </p>
          </div>
          
          <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 14px;">
            <p style="margin: 0;">© 2024 ${RESTAURANT_NAME}. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await sgMail.send(msg);
    console.log('✅ Reservation confirmation email sent successfully');
    return { success: true, message: 'Reservation confirmation email sent' };
  } catch (error) {
    console.error('❌ Reservation email error:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to check availability
async function checkAvailability(date, time) {
  try {
    console.log('🔍 AVAILABILITY CHECK STARTED');
    console.log('📅 Date:', date);
    console.log('🕐 Time:', time);
    console.log('📊 Current reservations count:', reservations.length);
    console.log('📊 Availability settings count:', availability.length);
    
    // Check if date is available
    const dateStr = new Date(date).toDateString();
    console.log('📅 Date string:', dateStr);
    
    const dayAvailability = availability.find(a => 
      new Date(a.date).toDateString() === dateStr
    );
    console.log('📅 Day availability found:', !!dayAvailability);
    
    if (dayAvailability && !dayAvailability.isAvailable) {
      console.log('❌ Date is blocked:', dayAvailability.blockedReasons);
      return {
        available: false,
        reason: dayAvailability.blockedReasons || 'Date is not available'
      };
    }
    
    // Check time is within operating hours
    if (dayAvailability) {
      const requestedTime = time;
      const openTime = dayAvailability.openTime || '12:00';
      const closeTime = dayAvailability.closeTime || '23:00';
      
      console.log('🕐 Time check - Requested:', requestedTime, 'Open:', openTime, 'Close:', closeTime);
      
      if (requestedTime < openTime || requestedTime > closeTime) {
        console.log('❌ Time outside operating hours');
        return {
          available: false,
          reason: `Restaurant is closed at ${time}. Operating hours: ${openTime} - ${closeTime}`
        };
      }
    }
    
    // Check reservation count for the day
    const dayReservations = reservations.filter(r => 
      new Date(r.reservationDate).toDateString() === dateStr
    );
    
    console.log('📊 Day reservations count:', dayReservations.length);
    
    const maxReservations = dayAvailability?.maxReservations || 50;
    console.log('📊 Max reservations allowed:', maxReservations);
    
    if (dayReservations.length >= maxReservations) {
      console.log('❌ Max reservations reached for this date');
      return {
        available: false,
        reason: 'No availability for this date'
      };
    }
    
    console.log('✅ Availability check passed - reservation allowed');
    return { available: true };
  } catch (error) {
    console.error('❌ Error checking availability:', error);
    return { available: false, reason: 'Error checking availability' };
  }
}

// Debug route for reservations
app.get('/debug/reservations', (req, res) => {
  res.json({
    success: true,
    reservations: reservations,
    reservationIdCounter: reservationIdCounter,
    totalReservations: reservations.length,
    mongoConnection: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Simple reservation creation route (bypasses availability check)
app.post('/api/reservations/simple', async (req, res) => {
  try {
    console.log('📅 SIMPLE RESERVATION CREATION STARTED');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    const { 
      customerName, 
      customerEmail, 
      customerPhone, 
      partySize, 
      reservationDate, 
      reservationTime, 
      specialRequests, 
      marketingConsent 
    } = req.body;
    
    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !partySize || !reservationDate || !reservationTime) {
      return res.status(400).json({ 
        success: false, 
        error: 'All required fields must be provided' 
      });
    }
    
    // Check if date is blocked
    const requestDate = new Date(reservationDate);
    const dateStr = `${requestDate.getFullYear()}-${String(requestDate.getMonth() + 1).padStart(2, '0')}-${String(requestDate.getDate()).padStart(2, '0')}`;
    
    const blockedDay = availability.find(a => {
      if (a.isAvailable) return false; // Not blocked if available
      const aDate = new Date(a.date);
      const aDateStr = `${aDate.getFullYear()}-${String(aDate.getMonth() + 1).padStart(2, '0')}-${String(aDate.getDate()).padStart(2, '0')}`;
      return aDateStr === dateStr;
    });
    
    if (blockedDay) {
      const blockReason = blockedDay.blockedReasons || 'This date is not available for bookings';
      console.log('❌ Date is blocked:', dateStr, 'Reason:', blockReason);
      return res.status(400).json({
        success: false,
        error: `Sorry, this date is not available. ${blockReason}. Please select another date.`
      });
    }
    
    console.log('✅ Date is available:', dateStr);
    
    const newReservation = {
      id: reservationIdCounter++,
      customerName,
      customerEmail,
      customerPhone,
      partySize: parseInt(partySize),
      reservationDate: new Date(reservationDate),
      reservationTime,
      status: 'pending',
      specialRequests: specialRequests || '',
      marketingConsent: marketingConsent === true,
      tableNumber: null,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log('🆕 Simple reservation created:', JSON.stringify(newReservation, null, 2));
    
    // Add to local array
    reservations.push(newReservation);
    console.log('📊 Reservations count after adding:', reservations.length);
    
    // Save to MongoDB if connected
    try {
      if (mongoose.connection.readyState === 1) {
        const reservationDoc = new Reservation(newReservation);
        await reservationDoc.save();
        console.log(`✅ Simple reservation ${newReservation.id} saved to MongoDB`);
      }
    } catch (mongoError) {
      console.error('❌ MongoDB save error:', mongoError);
    }
    
    // Save to files
    saveReservationsData();
    console.log('✅ Simple reservation saved to files');
    
    // Save client if marketing consent is given
    console.log('📊 Marketing consent value:', marketingConsent);
    console.log('📊 Current clients count:', clients.length);
    
    if (marketingConsent) {
      try {
        console.log('✅ Marketing consent given, proceeding to save client...');
        
        // Check if client exists in MongoDB first, then local array
        let existingClient = null;
        if (mongoose.connection.readyState === 1) {
          existingClient = await Client.findOne({ email: customerEmail });
          console.log('🔍 MongoDB check - existing client:', existingClient ? 'Found' : 'Not found');
        }
        
        if (!existingClient) {
          existingClient = clients.find(c => c.email === customerEmail);
          console.log('🔍 Local array check - existing client:', existingClient ? 'Found' : 'Not found');
        }
        
        if (!existingClient) {
          const newClient = {
            id: clients.length > 0 ? Math.max(...clients.map(c => c.id)) + 1 : 1,
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            marketingConsent: true,
            totalOrders: 0,
            totalSpent: 0,
            totalReservations: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          console.log('🆕 Creating new client:', JSON.stringify(newClient, null, 2));
          
          // Add to local array first
          clients.push(newClient);
          console.log('✅ Added to local clients array, new count:', clients.length);
          
          // Save to MongoDB
          if (mongoose.connection.readyState === 1) {
            try {
              const clientDoc = await Client.create(newClient);
              console.log('✅ Client saved to MongoDB:', clientDoc._id);
            } catch (mongoErr) {
              console.error('❌ MongoDB save error:', mongoErr);
            }
          }
          
          // Save to file
          saveClientsData();
          console.log('✅ Clients data saved to file');
          console.log('✅ NEW CLIENT CREATED SUCCESSFULLY FROM RESERVATION');
        } else {
          console.log('ℹ️ Client already exists, updating...');
          // Update existing client's reservation count
          if (existingClient._id) {
            // MongoDB object
            await Client.findByIdAndUpdate(existingClient._id, {
              $inc: { totalReservations: 1 },
              updatedAt: new Date()
            });
            console.log('✅ Updated client in MongoDB');
          } else {
            // Local array object
            existingClient.totalReservations = (existingClient.totalReservations || 0) + 1;
            existingClient.updatedAt = new Date().toISOString();
            console.log('✅ Updated client in local array');
          }
          
          saveClientsData();
          console.log('✅ Updated existing client reservation count');
        }
      } catch (clientError) {
        console.error('❌ CLIENT SAVE ERROR:', clientError);
        console.error('❌ Error stack:', clientError.stack);
      }
    } else {
      console.log('⚠️ Marketing consent NOT given, skipping client save');
    }
    
    // Send email confirmation
    try {
      const emailResult = await sendReservationConfirmation(newReservation);
      console.log('📧 Email confirmation result:', emailResult);
    } catch (emailError) {
      console.error('❌ Email confirmation failed:', emailError);
      // Don't fail the reservation if email fails
    }
    
    res.json({ 
      success: true, 
      reservation: newReservation,
      message: 'Simple reservation created successfully'
    });
  } catch (error) {
    console.error('❌ Simple reservation creation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create simple reservation' 
    });
  }
});

// Test route to create a sample reservation
app.post('/debug/create-test-reservation', async (req, res) => {
  try {
    console.log('🧪 Creating test reservation...');
    
    const testReservation = {
      id: reservationIdCounter++,
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      customerPhone: '555-1234',
      partySize: 4,
      reservationDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      reservationTime: '19:00',
      status: 'pending',
      specialRequests: 'Test reservation for debugging',
      marketingConsent: true,
      tableNumber: '5',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log('🧪 Test reservation created:', JSON.stringify(testReservation, null, 2));
    
    // Add to local array
    reservations.push(testReservation);
    console.log('🧪 Added to local array, count:', reservations.length);
    
    // Save to MongoDB if connected
    try {
      if (mongoose.connection.readyState === 1) {
        const reservationDoc = new Reservation(testReservation);
        await reservationDoc.save();
        console.log('🧪 Test reservation saved to MongoDB');
      }
    } catch (mongoError) {
      console.error('❌ MongoDB save error:', mongoError);
    }
    
    // Save to files
    saveReservationsData();
    console.log('🧪 Test reservation saved to files');
    
    res.json({
      success: true,
      message: 'Test reservation created',
      reservation: testReservation,
      totalReservations: reservations.length
    });
  } catch (error) {
    console.error('❌ Test reservation creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    serverVersion: '2.0.0 - Enhanced Order Status Updates',
    orders: orders.length,
    reservations: reservations.length,
    clients: clients.length
  });
});

// QUANTITY FIELD MIGRATION ROUTE
app.post('/admin/fix-quantities', authMiddleware, async (req, res) => {
  try {
    console.log('🔧 FIXING QUANTITY FIELDS...');
    
    if (mongoose.connection.readyState === 1) {
      // Get all orders
      const allOrders = await Order.find();
      console.log(`🔧 Found ${allOrders.length} orders to check`);
      
      let fixedCount = 0;
      
      for (const order of allOrders) {
        let needsUpdate = false;
        
        // Check each item in the order
        for (const item of order.items) {
          // If item has 'qty' but not 'quantity', add 'quantity'
          if (item.qty && !item.quantity) {
            item.quantity = item.qty;
            needsUpdate = true;
            console.log(`🔧 Fixed item ${item.id} in order ${order.id}: added quantity field`);
          }
          // If item has 'quantity' but not 'qty', add 'qty'
          else if (item.quantity && !item.qty) {
            item.qty = item.quantity;
            needsUpdate = true;
            console.log(`🔧 Fixed item ${item.id} in order ${order.id}: added qty field`);
          }
        }
        
        // Save the order if it was updated
        if (needsUpdate) {
          await order.save();
          fixedCount++;
        }
      }
      
      // Update local array
      orders.length = 0;
      const updatedOrders = await Order.find().sort({ createdAt: -1 });
      orders.push(...updatedOrders);
      
      // Save to file
      saveOrdersData();
      
      console.log(`🔧 QUANTITY FIX completed: Fixed ${fixedCount} orders`);
      
      res.json({
        success: true,
        message: 'Quantity fields fixed successfully',
        ordersFixed: fixedCount,
        totalOrders: orders.length
      });
    } else {
      res.json({
        success: false,
        message: 'MongoDB not connected'
      });
    }
  } catch (error) {
    console.error('❌ Quantity fix error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DUPLICATE INVESTIGATION ROUTE
app.get('/admin/investigate-duplicates', authMiddleware, async (req, res) => {
  try {
    console.log('🔍 INVESTIGATING DUPLICATES...');
    
    if (mongoose.connection.readyState === 1) {
      // Get all orders from MongoDB
      const allOrders = await Order.find().sort({ createdAt: -1 });
      console.log(`📊 Total orders in MongoDB: ${allOrders.length}`);
      
      // Group by ID to find duplicates
      const orderGroups = {};
      allOrders.forEach(order => {
        if (!orderGroups[order.id]) {
          orderGroups[order.id] = [];
        }
        orderGroups[order.id].push(order);
      });
      
      // Find duplicates
      const duplicates = {};
      let totalDuplicates = 0;
      
      for (const [orderId, orderList] of Object.entries(orderGroups)) {
        if (orderList.length > 1) {
          duplicates[orderId] = {
            count: orderList.length,
            orders: orderList.map(order => ({
              _id: order._id,
              id: order.id,
              status: order.status,
              customerName: order.customerName,
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,
              total: order.total
            }))
          };
          totalDuplicates += orderList.length - 1;
        }
      }
      
      console.log(`🔍 Found ${Object.keys(duplicates).length} order IDs with duplicates`);
      console.log(`🔍 Total duplicate orders: ${totalDuplicates}`);
      
      res.json({
        success: true,
        totalOrders: allOrders.length,
        uniqueOrderIds: Object.keys(orderGroups).length,
        duplicateOrderIds: Object.keys(duplicates).length,
        totalDuplicates: totalDuplicates,
        duplicates: duplicates,
        localOrdersCount: orders.length
      });
    } else {
      res.json({
        success: false,
        message: 'MongoDB not connected'
      });
    }
  } catch (error) {
    console.error('❌ Duplicate investigation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// FORCE TEST ROUTE - Test the override system
app.post('/test/force-order-edit/:id', (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status, discount } = req.body;
    
    console.log(`🧪 FORCE TEST: Order ${orderId} -> Status: ${status}, Discount: ${discount}`);
    
    // Find the order
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
      console.log(`❌ FORCE TEST: Order ${orderId} not found`);
      return res.status(404).json({ 
        success: false, 
        error: `Order ${orderId} not found`,
        availableIds: orders.map(o => o.id).slice(0, 5)
      });
    }
    
    const order = orders[orderIndex];
    
    // Update order properties
    if (status) {
      order.status = status;
      console.log(`✅ FORCE TEST: Updated status to ${status}`);
    }
    
    if (discount !== undefined) {
      order.discount = parseFloat(discount) || 0;
      
      // Recalculate total
      const itemsTotal = order.items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
        return sum + itemTotal;
      }, 0);
      
      order.total = Math.max(0, itemsTotal - order.discount);
      console.log(`✅ FORCE TEST: Updated discount to ${order.discount}, new total: ${order.total}`);
    }
    
    order.updatedAt = new Date().toISOString();
    
    // Force save to file
    saveOrdersData();
    console.log(`✅ FORCE TEST: File save completed`);
    
    console.log(`✅ FORCE TEST: Order ${orderId} updated successfully`);
    
    res.json({ 
      success: true, 
      message: 'Force test order updated successfully',
      orderId: orderId,
      newStatus: order.status,
      newDiscount: order.discount,
      newTotal: order.total
    });
    
  } catch (error) {
    console.error('❌ Force test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SIMPLE TEST ROUTE - No authentication required
app.post('/test/order-status/:id', (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    console.log(`🧪 TEST: Order ${orderId} -> ${status}`);
    
    // Find the order
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      console.log(`❌ TEST: Order ${orderId} not found`);
      return res.status(404).json({ 
        success: false, 
        error: `Order ${orderId} not found`,
        availableIds: orders.map(o => o.id).slice(0, 5)
      });
    }
    
    // Update the order
    order.status = status;
    order.updatedAt = new Date().toISOString();
    
    // Save to file
    saveOrdersData();
    
    console.log(`✅ TEST: Order ${orderId} updated to ${status}`);
    
    res.json({ 
      success: true, 
      message: `Order ${orderId} updated to ${status}`,
      orderId: orderId,
      newStatus: status
    });
    
  } catch (error) {
    console.error('Test route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW ORDER STATUS FLOW SYSTEM
// This handles the complete order lifecycle: pending -> confirmed -> completed
// Also handles cancellation at any stage

// Confirm Order (pending -> confirmed)
app.post('/orders/:id/confirm', authMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`✅ CONFIRM: Order ${orderId}`);
    
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    if (order.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Order is ${order.status}, cannot confirm` 
      });
    }
    
    order.status = 'confirmed';
    order.updatedAt = new Date().toISOString();
    saveOrdersData();
    
    console.log(`✅ Order ${orderId} confirmed`);
    
    res.json({ 
      success: true, 
      message: 'Order confirmed successfully',
      orderId: orderId,
      newStatus: 'confirmed'
    });
    
  } catch (error) {
    console.error('Confirm order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Complete Order (confirmed -> completed)
app.post('/orders/:id/complete', authMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`🏁 COMPLETE: Order ${orderId}`);
    
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    if (order.status !== 'confirmed') {
      return res.status(400).json({ 
        success: false, 
        error: `Order is ${order.status}, cannot complete` 
      });
    }
    
    order.status = 'completed';
    order.updatedAt = new Date().toISOString();
    saveOrdersData();
    
    console.log(`✅ Order ${orderId} completed`);
    
    res.json({ 
      success: true, 
      message: 'Order completed successfully',
      orderId: orderId,
      newStatus: 'completed'
    });
    
  } catch (error) {
    console.error('Complete order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel Order (any status -> cancelled)
app.post('/orders/:id/cancel', authMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`❌ CANCEL: Order ${orderId}`);
    
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    if (order.status === 'completed') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot cancel completed order' 
      });
    }
    
    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    saveOrdersData();
    
    console.log(`✅ Order ${orderId} cancelled`);
    
    res.json({ 
      success: true, 
      message: 'Order cancelled successfully',
      orderId: orderId,
      newStatus: 'cancelled'
    });
    
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kitchen Complete Order (kitchen staff can complete orders)
app.post('/kitchen/orders/:id/complete', kitchenAuthMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`🍳 KITCHEN COMPLETE: Order ${orderId}`);
    
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    if (order.status !== 'confirmed') {
      return res.status(400).json({ 
        success: false, 
        error: `Order is ${order.status}, cannot complete` 
      });
    }
    
    order.status = 'completed';
    order.updatedAt = new Date().toISOString();
    saveOrdersData();
    
    console.log(`✅ Kitchen completed order ${orderId}`);
    
    res.json({ 
      success: true, 
      message: 'Order completed by kitchen',
      orderId: orderId,
      newStatus: 'completed'
    });
    
  } catch (error) {
    console.error('Kitchen complete order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// MongoDB Debug Route - Test MongoDB operations
app.get('/debug/mongodb', async (req, res) => {
  try {
    const debugInfo = {
      connectionState: mongoose.connection.readyState,
      connectionStates: {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      },
      mongoDbUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
      ordersInMemory: orders.length,
      ordersInMongo: 0,
      sampleOrders: []
    };
    
    if (mongoose.connection.readyState === 1) {
      const mongoOrders = await Order.find().limit(5);
      debugInfo.ordersInMongo = await Order.countDocuments();
      debugInfo.sampleOrders = mongoOrders.map(o => ({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt
      }));
    }
    
    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test route to verify server.js is updated
app.get('/test-server-update', (req, res) => {
  res.json({ 
    message: 'Server.js has been updated with enhanced order status routes!',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Test route to check admin credentials (no auth required)
app.get('/test-admin-creds', (req, res) => {
  res.json({ 
    adminUser: ADMIN_USER,
    adminPass: ADMIN_PASS,
    message: 'Current admin credentials',
    timestamp: new Date().toISOString()
  });
});

// Test route for order status update (no auth required for testing)
app.post('/test-order-status/:id', (req, res) => {
  const orderId = parseInt(req.params.id);
  const { status } = req.body;
  
  console.log(`🧪 TEST ROUTE - Order ID: ${orderId}, Status: ${status}`);
  
  // Find order in file storage
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  
  // Update status
  order.status = status;
  order.updatedAt = new Date().toISOString();
  
  // Save to file
  saveOrdersData();
  
  res.json({ 
    success: true, 
    order: order,
    message: 'Order status updated successfully (TEST ROUTE)'
  });
});

// Get order data for editing - FIXED VERSION with MongoDB support
app.get('/admin/orders/:id/data', authMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    console.log(`🔍 Getting order data for editing - Order ID: ${orderId}`);
    
    let order = null;
    
    // Try MongoDB first
    if (mongoose.connection.readyState === 1) {
      order = await Order.findOne({ id: orderId });
      if (order) {
        console.log(`✅ Found order in MongoDB: ${orderId}`);
      } else {
        console.log(`⚠️ Order ${orderId} not found in MongoDB, trying file storage...`);
      }
    } else {
      console.log('⚠️ MongoDB not connected, using file storage...');
    }
    
    // Fallback to file storage
    if (!order) {
      order = orders.find(o => o.id === orderId);
      if (order) {
        console.log(`✅ Found order in file storage: ${orderId}`);
      }
    }
    
    if (!order) {
      console.log(`❌ Order ${orderId} not found in any storage`);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const orderData = {
      id: order.id,
      customerName: order.customerName || '',
      customerEmail: order.customerEmail || '',
      orderType: order.orderType || 'dine-in',
      status: order.status || 'pending',
      discount: order.discount || 0,
      notes: order.notes || '',
      total: order.total || 0
    };
    
    console.log('📊 Order data for editing:', orderData);
    
    res.json({
      success: true,
      order: orderData
    });
  } catch (error) {
    console.error('❌ Error getting order data:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Test route for order editing
app.get('/test/order-edit/:id', authMiddleware, (req, res) => {
  const orderId = parseInt(req.params.id);
  console.log(`🧪 Testing order edit access for order ID: ${orderId}`);
  
  // Check if order exists
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.json({ 
      success: false, 
      error: 'Order not found',
      availableOrders: orders.map(o => ({ id: o.id, status: o.status }))
    });
  }
  
  res.json({ 
    success: true, 
    order: { 
      id: order.id, 
      status: order.status, 
      customerName: order.customerName,
      total: order.total 
    },
    message: 'Order edit route is accessible'
  });
});

// Test POST route for order editing
app.post('/test/order-edit/:id', authMiddleware, (req, res) => {
  const orderId = parseInt(req.params.id);
  const { status, discount } = req.body;
  
  console.log(`🧪 Testing order edit POST for order ID: ${orderId}, status: ${status}, discount: ${discount}`);
  
  // Check if order exists
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.json({ 
      success: false, 
      error: 'Order not found',
      availableOrders: orders.map(o => ({ id: o.id, status: o.status }))
    });
  }
  
  // Simulate the update
  const originalStatus = order.status;
  order.status = status || order.status;
  order.discount = parseFloat(discount) || 0;
  order.updatedAt = new Date().toISOString();
  
  res.json({ 
    success: true, 
    order: { 
      id: order.id, 
      status: order.status, 
      originalStatus: originalStatus,
      discount: order.discount,
      customerName: order.customerName,
      total: order.total 
    },
    message: 'Order edit POST route is working'
  });
});


// DEBUG ROUTE - Test order editing without authentication
app.post('/test/order-edit/:id', (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status, discount } = req.body;
    
    console.log(`🧪 TEST EDIT: Order ${orderId} -> Status: ${status}, Discount: ${discount}`);
    
    // Find the order
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      console.log(`❌ TEST: Order ${orderId} not found`);
      return res.status(404).json({ 
        success: false, 
        error: `Order ${orderId} not found`,
        availableIds: orders.map(o => o.id).slice(0, 5)
      });
    }
    
    console.log(`✅ TEST: Found order ${orderId}, current status: ${order.status}, current discount: ${order.discount}`);
    
    // Update the order
    if (status) order.status = status;
    if (discount !== undefined) {
      order.discount = parseFloat(discount) || 0;
      // Recalculate total
      const itemsTotal = order.items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.qty || item.quantity || 1);
        return sum + itemTotal;
      }, 0);
      order.total = Math.max(0, itemsTotal - order.discount);
    }
    order.updatedAt = new Date().toISOString();
    
    // Save to file
    saveOrdersData();
    
    console.log(`✅ TEST: Order ${orderId} updated - Status: ${order.status}, Discount: ${order.discount}, Total: ${order.total}`);
    
    res.json({ 
      success: true, 
      message: `Order ${orderId} updated successfully`,
      orderId: orderId,
      newStatus: order.status,
      newDiscount: order.discount,
      newTotal: order.total
    });
    
  } catch (error) {
    console.error('Test edit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NO AUTH TEST - Test without authentication
app.post('/test/orders/:id/edit', (req, res) => {
  const orderId = parseInt(req.params.id);
  const { status, customerName } = req.body;
  
  console.log(`🧪 NO AUTH TEST - Order ID: ${orderId}, Status: ${status}, Customer: ${customerName}`);
  console.log(`📊 Request body:`, req.body);
  
  res.json({ 
    success: true, 
    message: 'No auth test successful',
    receivedData: { orderId, status, customerName }
  });
});

// BASIC TEST - Test if server is receiving requests
app.post('/test/basic', (req, res) => {
  console.log('🧪 BASIC TEST - Server received request');
  console.log('📊 Request body:', req.body);
  res.json({ 
    success: true, 
    message: 'Basic test successful',
    timestamp: new Date().toISOString()
  });
});

// TEST - Get current orders
app.get('/test/orders', (req, res) => {
  console.log('🧪 ORDERS TEST - Getting current orders');
  res.json({ 
    success: true, 
    orders: orders.map(o => ({ 
      id: o.id, 
      status: o.status, 
      customerName: o.customerName,
      total: o.total,
      createdAt: o.createdAt || o.timestamp
    })),
    count: orders.length
  });
});

// Clean up duplicate order IDs
app.post('/admin/cleanup-duplicates', authMiddleware, async (req, res) => {
  try {
    console.log('🧹 Starting duplicate order cleanup...');
    
    // Get all orders and group by ID
    const orderGroups = {};
    orders.forEach(order => {
      if (!orderGroups[order.id]) {
        orderGroups[order.id] = [];
      }
      orderGroups[order.id].push(order);
    });
    
    // Find duplicates
    const duplicates = Object.keys(orderGroups).filter(id => orderGroups[id].length > 1);
    console.log(`📊 Found ${duplicates.length} order IDs with duplicates:`, duplicates);
    
    let cleanedCount = 0;
    
    // Clean up duplicates by keeping only the most recent one
    duplicates.forEach(id => {
      const ordersWithId = orderGroups[id];
      const sortedOrders = ordersWithId.sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp));
      
      // Keep the most recent one, remove the rest
      const keepOrder = sortedOrders[0];
      const removeOrders = sortedOrders.slice(1);
      
      console.log(`🔧 Cleaning ID ${id}: Keeping order from ${keepOrder.createdAt || keepOrder.timestamp}, removing ${removeOrders.length} duplicates`);
      
      // Remove duplicates from the orders array
      removeOrders.forEach(removeOrder => {
        const index = orders.findIndex(o => o === removeOrder);
        if (index !== -1) {
          orders.splice(index, 1);
          cleanedCount++;
        }
      });
    });
    
    // Save the cleaned data
    saveOrdersData();
    
    console.log(`✅ Cleanup completed: Removed ${cleanedCount} duplicate orders`);
    
    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} duplicate orders`,
      duplicatesFound: duplicates.length,
      ordersRemoved: cleanedCount
    });
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({ success: false, error: 'Cleanup failed' });
  }
});

// Fix orders with NaN totals - ENHANCED VERSION
app.post('/admin/fix-nan-totals', authMiddleware, async (req, res) => {
  try {
    console.log('🔧 Starting enhanced NaN total fix...');
    
    let fixedCount = 0;
    const fixedOrders = [];
    
    orders.forEach((order, index) => {
      const currentTotal = order.total;
      const isInvalidTotal = isNaN(currentTotal) || currentTotal === null || currentTotal === undefined || currentTotal === 'NaN';
      
      if (isInvalidTotal) {
        console.log(`🔧 Fixing order ${order.id} with invalid total: ${currentTotal}`);
        
        if (order.items && Array.isArray(order.items) && order.items.length > 0) {
          // Recalculate from items
          const itemsTotal = order.items.reduce((sum, item) => {
            const itemPrice = parseFloat(item.price) || 0;
            const quantity = parseInt(item.qty || item.quantity || 1);
            const itemTotal = itemPrice * quantity;
            console.log(`  📊 Item ${item.id}: ${itemPrice} × ${quantity} = ${itemTotal}`);
            return sum + itemTotal;
          }, 0);
          
          const discountAmount = parseFloat(order.discount) || 0;
          const finalTotal = Math.max(0, itemsTotal - discountAmount);
          
          console.log(`  📊 Recalculated: ${itemsTotal} - ${discountAmount} = ${finalTotal}`);
          orders[index].total = finalTotal;
          orders[index].updatedAt = new Date().toISOString();
          
          fixedOrders.push({
            id: order.id,
            oldTotal: currentTotal,
            newTotal: finalTotal,
            itemsCount: order.items.length
          });
          fixedCount++;
        } else {
          // No items or invalid items, set to 0
          console.log(`  📊 No valid items, setting total to 0`);
          orders[index].total = 0;
          orders[index].updatedAt = new Date().toISOString();
          
          fixedOrders.push({
            id: order.id,
            oldTotal: currentTotal,
            newTotal: 0,
            itemsCount: 0
          });
          fixedCount++;
        }
      }
    });
    
    // Save the fixed data
    saveOrdersData();
    
    console.log(`✅ Enhanced NaN total fix completed: Fixed ${fixedCount} orders`);
    
    res.json({ 
      success: true, 
      message: `Fixed ${fixedCount} orders with NaN totals`,
      ordersFixed: fixedCount,
      fixedOrders: fixedOrders
    });
    
  } catch (error) {
    console.error('❌ Enhanced NaN fix error:', error);
    res.status(500).json({ success: false, error: 'Enhanced NaN fix failed' });
  }
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

function loadReservationsData() {
  try {
    // Try to load from primary location first
    if (fs.existsSync(RESERVATIONS_DATA_FILE)) {
      const data = fs.readFileSync(RESERVATIONS_DATA_FILE, 'utf8');
      const reservationsData = JSON.parse(data);
      reservations = reservationsData.reservations || [];
      reservationIdCounter = reservationsData.reservationIdCounter || 1;
      console.log(`✅ Loaded ${reservations.length} reservations from files`);
    } else {
      console.log('📁 No reservations data file found, starting fresh');
    }
  } catch (error) {
    console.error('❌ Error loading reservations data:', error);
    reservations = [];
    reservationIdCounter = 1;
  }
}

function saveReservationsData() {
  try {
    const reservationsData = {
      reservations: reservations,
      reservationIdCounter: reservationIdCounter
    };
    const data = JSON.stringify(reservationsData, null, 2);
    
    // Ensure data directory exists before writing
    const dataDir = path.dirname(RESERVATIONS_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write to primary location
    fs.writeFileSync(RESERVATIONS_DATA_FILE, data);
    
    console.log('✅ Reservations data saved to files');
  } catch (error) {
    console.error('❌ Error saving reservations data:', error);
  }
}

function saveAvailabilityData() {
  try {
    const availabilityData = {
      availability: availability
    };
    const data = JSON.stringify(availabilityData, null, 2);
    
    // Ensure data directory exists before writing
    const dataDir = path.dirname(AVAILABILITY_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write to primary location
    fs.writeFileSync(AVAILABILITY_DATA_FILE, data);
    
    console.log('✅ Availability data saved to files');
  } catch (error) {
    console.error('❌ Error saving availability data:', error);
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
    // Clean up corrupted data first
    await cleanupCorruptedData();
    
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
  
  // Fix any orders with NaN totals - ENHANCED VERSION
  console.log('🔧 Checking for orders with NaN totals...');
  let fixedCount = 0;
  orders.forEach((order, index) => {
    const currentTotal = order.total;
    const isInvalidTotal = isNaN(currentTotal) || currentTotal === null || currentTotal === undefined || currentTotal === 'NaN';
    
    if (isInvalidTotal) {
      console.log(`🔧 Fixing order ${order.id} with invalid total: ${currentTotal}`);
      
      if (order.items && Array.isArray(order.items) && order.items.length > 0) {
        // Recalculate from items
        const itemsTotal = order.items.reduce((sum, item) => {
          const itemPrice = parseFloat(item.price) || 0;
          const quantity = parseInt(item.qty || item.quantity || 1);
          const itemTotal = itemPrice * quantity;
          console.log(`  📊 Item ${item.id}: ${itemPrice} × ${quantity} = ${itemTotal}`);
          return sum + itemTotal;
        }, 0);
        
        const discountAmount = parseFloat(order.discount) || 0;
        const finalTotal = Math.max(0, itemsTotal - discountAmount);
        
        console.log(`  📊 Recalculated: ${itemsTotal} - ${discountAmount} = ${finalTotal}`);
        orders[index].total = finalTotal;
        orders[index].updatedAt = new Date().toISOString();
        fixedCount++;
      } else {
        // No items or invalid items, set to 0
        console.log(`  📊 No valid items, setting total to 0`);
        orders[index].total = 0;
        orders[index].updatedAt = new Date().toISOString();
        fixedCount++;
      }
    }
  });
  
  if (fixedCount > 0) {
    console.log(`✅ Fixed ${fixedCount} orders with NaN totals`);
    saveOrdersData();
  }
  
  // Clean up duplicate orders automatically
  console.log('🧹 Checking for duplicate orders...');
  const orderGroups = {};
  orders.forEach(order => {
    if (!orderGroups[order.id]) {
      orderGroups[order.id] = [];
    }
    orderGroups[order.id].push(order);
  });
  
  const duplicates = Object.keys(orderGroups).filter(id => orderGroups[id].length > 1);
  if (duplicates.length > 0) {
    console.log(`⚠️ Found ${duplicates.length} order IDs with duplicates:`, duplicates);
    
    let cleanedCount = 0;
    duplicates.forEach(id => {
      const ordersWithId = orderGroups[id];
      const sortedOrders = ordersWithId.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.timestamp || 0);
        const dateB = new Date(b.createdAt || b.timestamp || 0);
        return dateB - dateA; // Most recent first
      });
      
      // Keep the most recent one, remove the rest
      const keepOrder = sortedOrders[0];
      const removeOrders = sortedOrders.slice(1);
      
      console.log(`🔧 Cleaning ID ${id}: Keeping most recent, removing ${removeOrders.length} duplicates`);
      
      // Remove duplicates from the orders array
      removeOrders.forEach(removeOrder => {
        const index = orders.findIndex(o => o === removeOrder);
        if (index !== -1) {
          orders.splice(index, 1);
          cleanedCount++;
        }
      });
    });
    
    if (cleanedCount > 0) {
      console.log(`✅ Cleaned up ${cleanedCount} duplicate orders`);
      saveOrdersData();
    }
  }
  
  console.log(`📊 Total orders: ${orders.length}`);
  console.log(`📊 Total categories: ${menuData.categories.length}`);
  console.log(`📊 Total menu items: ${menuData.items.length}`);
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
