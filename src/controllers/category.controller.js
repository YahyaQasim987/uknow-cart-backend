import { pool } from '../config/db.js';

export class CategoryController {
  static async list(req, res, next) {
    try {
      const [catRows] = await pool.query('SELECT * FROM categories WHERE is_active = TRUE ORDER BY display_order ASC');
      const [subRows] = await pool.query('SELECT * FROM sub_categories WHERE is_active = TRUE ORDER BY display_order ASC');

      const categories = catRows.map(cat => ({
        id: cat.id,
        name: cat.name,
        icon: cat.icon || '💎',
        image: cat.image_url || '',
        imageUrl: cat.image_url || '',
        description: cat.description || '',
        displayOrder: parseInt(cat.display_order, 10) || 0,
        isActive: !!cat.is_active,
        subCategories: subRows
          .filter(sub => String(sub.category_id) === String(cat.id))
          .map(sub => ({
            id: sub.id,
            categoryId: sub.category_id,
            name: sub.name,
            image: sub.image_url || '',
            imageUrl: sub.image_url || '',
            description: sub.description || '',
            displayOrder: parseInt(sub.display_order, 10) || 0,
            isActive: !!sub.is_active
          }))
      }));

      res.json({ success: true, count: categories.length, categories });
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const { id, name, icon = '💎', image = '', imageUrl = '', description = '', displayOrder = 0 } = req.body;
      if (!id || !name) {
        return res.status(400).json({ success: false, message: 'Category ID and Name are required.' });
      }

      const finalImg = image || imageUrl || '';
      const catId = id.toLowerCase().trim();

      await pool.query(`
        INSERT INTO categories (id, name, icon, image_url, description, display_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, TRUE)
      `, [catId, name.trim(), icon, finalImg, description, parseInt(displayOrder, 10) || 0]);

      res.status(201).json({
        success: true,
        message: 'Category created successfully.',
        category: { id: catId, name: name.trim(), icon, image: finalImg, imageUrl: finalImg, description, subCategories: [] }
      });
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, icon, image, imageUrl, description, displayOrder, isActive } = req.body;

      const fields = [];
      const values = [];

      if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
      if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
      if (image !== undefined || imageUrl !== undefined) { fields.push('image_url = ?'); values.push(image || imageUrl); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description); }
      if (displayOrder !== undefined) { fields.push('display_order = ?'); values.push(parseInt(displayOrder, 10) || 0); }
      if (isActive !== undefined) { fields.push('is_active = ?'); values.push(!!isActive); }

      if (fields.length > 0) {
        values.push(id);
        const [result] = await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, message: `Category "${id}" not found.` });
        }
      }

      if (!fields.length) {
        return res.status(400).json({ success: false, message: 'At least one category field is required.' });
      }

      res.json({ success: true, message: `Category "${id}" updated successfully.` });
    } catch (err) {
      next(err);
    }
  }

  static async createSubcategory(req, res, next) {
    try {
      const { categoryId } = req.params;
      const { name, image = '', imageUrl = '', description = '', displayOrder = 0 } = req.body;
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Subcategory name is required.' });
      }

      const finalImage = image || imageUrl || '';
      const [result] = await pool.query(`
        INSERT INTO sub_categories (category_id, name, image_url, description, display_order, is_active)
        VALUES (?, ?, ?, ?, ?, TRUE)
      `, [categoryId, name.trim(), finalImage, description, parseInt(displayOrder, 10) || 0]);

      res.status(201).json({
        success: true,
        subcategory: {
          id: result.insertId,
          categoryId,
          name: name.trim(),
          image: finalImage,
          imageUrl: finalImage,
          description,
          displayOrder: parseInt(displayOrder, 10) || 0,
          isActive: true
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateSubcategory(req, res, next) {
    try {
      const { id } = req.params;
      const { name, image, imageUrl, description, displayOrder, isActive } = req.body;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ success: false, message: 'Subcategory name cannot be empty.' });
        }
        fields.push('name = ?');
        values.push(name.trim());
      }
      if (image !== undefined || imageUrl !== undefined) { fields.push('image_url = ?'); values.push(image || imageUrl); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description); }
      if (displayOrder !== undefined) { fields.push('display_order = ?'); values.push(parseInt(displayOrder, 10) || 0); }
      if (isActive !== undefined) { fields.push('is_active = ?'); values.push(!!isActive); }

      if (!fields.length) {
        return res.status(400).json({ success: false, message: 'At least one subcategory field is required.' });
      }

      values.push(id);
      const [result] = await pool.query(
        `UPDATE sub_categories SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      if (!result.affectedRows) {
        return res.status(404).json({ success: false, message: `Subcategory "${id}" not found.` });
      }

      res.json({ success: true, message: `Subcategory "${id}" updated successfully.` });
    } catch (err) {
      next(err);
    }
  }

  static async deleteSubcategory(req, res, next) {
    try {
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM sub_categories WHERE id = ?', [id]);
      if (!result.affectedRows) {
        return res.status(404).json({ success: false, message: `Subcategory "${id}" not found.` });
      }
      res.json({ success: true, message: `Subcategory "${id}" deleted successfully.` });
    } catch (err) {
      next(err);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      // Check dependent products to prevent orphan records
      const [prodRows] = await pool.query('SELECT COUNT(*) AS count FROM products WHERE category_id = ? AND archived_at IS NULL', [id]);
      if (prodRows[0].count > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete category "${id}". It has ${prodRows[0].count} dependent products. Please reassign products first.`
        });
      }

      const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `Category "${id}" not found.` });
      }

      res.json({ success: true, message: `Category "${id}" deleted successfully.` });
    } catch (err) {
      next(err);
    }
  }
}

export class BrandController {
  static async list(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM brands ORDER BY name ASC');
      const brands = rows.map(b => ({
        id: b.id,
        name: b.name,
        image: b.image_url || '',
        imageUrl: b.image_url || '',
        description: b.description || '',
        isFeatured: !!b.is_featured,
        featured: !!b.is_featured
      }));
      res.json({ success: true, count: brands.length, brands });
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, image = '', imageUrl = '', description = '', isFeatured = false, featured = false } = req.body;
      if (!name) return res.status(400).json({ success: false, message: 'Brand name is required.' });

      const finalImg = image || imageUrl || '';
      const isFeat = isFeatured || featured;

      const [result] = await pool.query(`
        INSERT INTO brands (name, image_url, description, is_featured)
        VALUES (?, ?, ?, ?)
      `, [name.trim(), finalImg, description, !!isFeat]);

      res.status(201).json({
        success: true,
        brand: { id: result.insertId, name: name.trim(), image: finalImg, imageUrl: finalImg, description, isFeatured: isFeat, featured: isFeat }
      });
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, image, imageUrl, description, isFeatured, featured } = req.body;

      const fields = [];
      const values = [];

      if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
      if (image !== undefined || imageUrl !== undefined) { fields.push('image_url = ?'); values.push(image || imageUrl); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description); }
      if (isFeatured !== undefined || featured !== undefined) { fields.push('is_featured = ?'); values.push(!!(isFeatured ?? featured)); }

      if (fields.length > 0) {
        values.push(id);
        const [result] = await pool.query(`UPDATE brands SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, message: `Brand "${id}" not found.` });
        }
      }

      res.json({ success: true, message: `Brand "${id}" updated successfully.` });
    } catch (err) {
      next(err);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      const [bRows] = await pool.query('SELECT name FROM brands WHERE id = ?', [id]);
      if (bRows.length === 0) {
        return res.status(404).json({ success: false, message: `Brand "${id}" not found.` });
      }

      // Check dependent products
      const [prodRows] = await pool.query('SELECT COUNT(*) AS count FROM products WHERE brand = ? AND archived_at IS NULL', [bRows[0].name]);
      if (prodRows[0].count > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete brand "${bRows[0].name}". It has ${prodRows[0].count} dependent products. Please reassign products first.`
        });
      }

      await pool.query('DELETE FROM brands WHERE id = ?', [id]);
      res.json({ success: true, message: `Brand "${bRows[0].name}" deleted successfully.` });
    } catch (err) {
      next(err);
    }
  }
}
