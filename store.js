const fs = require('fs');
const path = require('path');

class Store {
  constructor(app) {
    this.path = path.join(app.getPath('userData'), 'ghost-mode-settings.json');
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch {
      return { home: null, favorites: [] };
    }
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  getHome() {
    return this.data.home;
  }

  setHome(lat, lng, label) {
    this.data.home = { lat, lng, label };
    this._save();
  }

  getFavorites() {
    return this.data.favorites;
  }

  addFavorite(lat, lng, label) {
    this.data.favorites.push({ lat, lng, label });
    this._save();
  }

  removeFavorite(index) {
    this.data.favorites.splice(index, 1);
    this._save();
  }
}

module.exports = Store;
