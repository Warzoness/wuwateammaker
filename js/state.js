/**
 * State Management for Wuthering Waves Matrix Team Maker
 */
import { CHARACTERS_DATA } from './characters-data.js';

const STORAGE_KEY = 'wuwa_team_maker_state_v1';

export class AppState {
  constructor() {
    this.characters = [];
    this.currentSquad = [null, null, null]; // 3 slots
    this.savedTeams = []; // list of saved team compositions
    this.editingTeamId = null; // id of team being edited, null = creating new
    this.filters = {
      search: '',
      attribute: 'ALL',
      weapon: 'ALL',
      rarity: 'ALL',
      energyStatus: 'ALL'
    };
    this.defaultMaxEnergy = 4;
    this.listeners = [];

    this.loadInitialState();
  }

  loadInitialState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.defaultMaxEnergy = parsed.defaultMaxEnergy || 4;
        this.savedTeams = parsed.savedTeams || [];
        this.editingTeamId = parsed.editingTeamId || null;

        // Reconstruct characters with saved energy
        const savedEnergyMap = parsed.characterEnergy || {};
        this.characters = CHARACTERS_DATA.map(c => {
          const userSaved = savedEnergyMap[c.id];
          const maxEnergy = userSaved ? userSaved.maxEnergy : this.defaultMaxEnergy;
          const currentEnergy = userSaved ? userSaved.currentEnergy : maxEnergy;
          return {
            ...c,
            maxEnergy: Math.max(0, maxEnergy),
            currentEnergy: Math.max(0, currentEnergy)
          };
        });

        // Reconstruct current squad
        if (Array.isArray(parsed.currentSquadIds)) {
          this.currentSquad = parsed.currentSquadIds.map(id => {
            return id ? this.characters.find(c => c.id === id) || null : null;
          });
        }
        return;
      } catch (e) {
        console.warn('Failed to parse saved state, using default', e);
      }
    }

    // Default initialization
    this.characters = CHARACTERS_DATA.map(c => ({
      ...c,
      maxEnergy: this.defaultMaxEnergy,
      currentEnergy: this.defaultMaxEnergy
    }));
  }

  saveState() {
    try {
      const characterEnergy = {};
      this.characters.forEach(c => {
        characterEnergy[c.id] = {
          maxEnergy: c.maxEnergy,
          currentEnergy: c.currentEnergy
        };
      });

      const dataToSave = {
        defaultMaxEnergy: this.defaultMaxEnergy,
        savedTeams: this.savedTeams,
        editingTeamId: this.editingTeamId,
        characterEnergy,
        currentSquadIds: this.currentSquad.map(c => (c ? c.id : null))
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.warn('Failed to save state to localStorage', e);
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.saveState();
    this.listeners.forEach(fn => fn(this));
  }

  // Check if squad is completely filled (3/3)
  isSquadComplete() {
    return this.currentSquad.every(slot => slot !== null);
  }

  // Count current filled slots
  getFilledSlotCount() {
    return this.currentSquad.filter(slot => slot !== null).length;
  }

  // Check if a character is currently in the squad
  isCharacterInSquad(charId) {
    return this.currentSquad.some(slot => slot && slot.id === charId);
  }

  // Get slot index of a character in the squad (-1 if not in squad)
  getCharacterSquadSlot(charId) {
    return this.currentSquad.findIndex(slot => slot && slot.id === charId);
  }

  // Set default max energy for all characters
  setDefaultMaxEnergy(value) {
    const num = Math.max(1, parseInt(value, 10) || 1);
    this.defaultMaxEnergy = num;
    this.characters.forEach(c => {
      // Scale or set max energy
      c.maxEnergy = num;
      // If not in current squad, set to max; if in squad, set to max - 1
      const inSquad = this.isCharacterInSquad(c.id);
      c.currentEnergy = inSquad ? Math.max(0, num - 1) : num;
    });
    this.notify();
  }

  // Reset all characters energy to their max energy (re-evaluating squad occupancy)
  resetAllEnergy() {
    this.characters.forEach(c => {
      const inSquad = this.isCharacterInSquad(c.id);
      c.currentEnergy = inSquad ? Math.max(0, c.maxEnergy - 1) : c.maxEnergy;
    });
    this.notify();
  }

  // Update a single character's energy
  updateCharacterEnergy(charId, newEnergy, newMaxEnergy = null) {
    const char = this.characters.find(c => c.id === charId);
    if (!char) return;

    if (newMaxEnergy !== null) {
      char.maxEnergy = Math.max(1, parseInt(newMaxEnergy, 10) || 1);
    }

    const energyVal = Math.max(0, parseInt(newEnergy, 10) || 0);
    char.currentEnergy = Math.min(char.maxEnergy, energyVal);
    this.notify();
  }

  // Assign character to slot
  assignToSlot(charId, targetSlotIndex) {
    if (targetSlotIndex < 0 || targetSlotIndex > 2) return false;

    const char = this.characters.find(c => c.id === charId);
    if (!char) return false;

    const existingSlotIndex = this.getCharacterSquadSlot(charId);

    // If character is already in this exact slot, do nothing
    if (existingSlotIndex === targetSlotIndex) {
      return false;
    }

    // Case 1: Character is moving from another slot to this slot (SWAP or MOVE)
    if (existingSlotIndex !== -1) {
      const occupantInTarget = this.currentSquad[targetSlotIndex];
      // Swap slots
      this.currentSquad[targetSlotIndex] = char;
      this.currentSquad[existingSlotIndex] = occupantInTarget;
      this.notify();
      return true;
    }

    // Case 2: Character is coming from character pool into slot
    // Check if character has enough energy (> 0)
    if (char.currentEnergy <= 0) {
      return false; // Cannot assign exhausted character
    }

    // Check if target slot is already occupied
    const existingOccupant = this.currentSquad[targetSlotIndex];
    if (existingOccupant) {
      // Return energy to previous occupant
      existingOccupant.currentEnergy = Math.min(existingOccupant.maxEnergy, existingOccupant.currentEnergy + 1);
    }

    // Deduct 1 energy from the newly assigned character
    char.currentEnergy = Math.max(0, char.currentEnergy - 1);
    this.currentSquad[targetSlotIndex] = char;

    this.notify();
    return true;
  }

  // Remove character from slot
  removeFromSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex > 2) return;

    const char = this.currentSquad[slotIndex];
    if (!char) return;

    // Refund 1 energy back
    char.currentEnergy = Math.min(char.maxEnergy, char.currentEnergy + 1);
    this.currentSquad[slotIndex] = null;

    this.notify();
  }

  // Clear all slots in the current squad
  clearSquad() {
    this.currentSquad.forEach(char => {
      if (char) {
        char.currentEnergy = Math.min(char.maxEnergy, char.currentEnergy + 1);
      }
    });
    this.currentSquad = [null, null, null];
    this.notify();
  }

  // Auto-assign character to first empty slot
  autoAssign(charId) {
    const firstEmptyIndex = this.currentSquad.findIndex(s => s === null);
    if (firstEmptyIndex !== -1) {
      return this.assignToSlot(charId, firstEmptyIndex);
    }
    return false;
  }

  // Save current squad as a new team or update existing
  saveTeam(teamName) {
    if (!this.isSquadComplete()) return false;

    const teamRecord = {
      id: this.editingTeamId || `team-${Date.now()}`,
      name: teamName || `Team ${this.savedTeams.length + 1}`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString('vi-VN'),
      members: this.currentSquad.map(c => ({
        id: c.id,
        name: c.name,
        image: c.image,
        attribute: c.attribute,
        rarity: c.rarity,
        weapon: c.weapon,
        remainingEnergy: c.currentEnergy
      }))
    };

    if (this.editingTeamId) {
      // Update existing team
      const idx = this.savedTeams.findIndex(t => t.id === this.editingTeamId);
      if (idx !== -1) this.savedTeams[idx] = teamRecord;
      this.editingTeamId = null;
    } else {
      // Add new team
      this.savedTeams.push(teamRecord);
    }

    // Clear squad after saving
    this.currentSquad = [null, null, null];
    this.notify();
    return teamRecord;
  }

  // Delete a saved team by id
  deleteTeam(teamId) {
    const team = this.savedTeams.find(t => t.id === teamId);
    if (team) {
      // Refund 1 energy to each member of the deleted team
      // (only if they are NOT currently in the active squad to avoid double-refund)
      team.members.forEach(m => {
        const char = this.characters.find(c => c.id === m.id);
        if (char && !this.isCharacterInSquad(char.id)) {
          char.currentEnergy = Math.min(char.maxEnergy, char.currentEnergy + 1);
        }
      });
    }
    this.savedTeams = this.savedTeams.filter(t => t.id !== teamId);
    if (this.editingTeamId === teamId) this.editingTeamId = null;
    this.notify();
  }

  // Load a saved team back into the editor for editing
  editTeam(teamId) {
    const team = this.savedTeams.find(t => t.id === teamId);
    if (!team) return;

    // Clear current squad first (refund energy to currently slotted chars)
    this.clearSquad();

    // Load team members into slots.
    // Energy was already spent (-1) when this team was originally saved.
    // We restore that 1 energy first, then deduct it again for the slot,
    // so the net effect is zero — and ALL members are guaranteed to load.
    team.members.forEach((m, idx) => {
      const char = this.characters.find(c => c.id === m.id);
      if (char) {
        // Restore 1 energy (undo the deduction from when the team was saved)
        char.currentEnergy = Math.min(char.maxEnergy, char.currentEnergy + 1);
        // Deduct 1 energy for occupying this slot
        char.currentEnergy = Math.max(0, char.currentEnergy - 1);
        this.currentSquad[idx] = char;
      }
    });

    this.editingTeamId = teamId;
    this.notify();
  }

  // Clear all saved teams
  clearAllTeams() {
    this.clearSquad();
    this.savedTeams = [];
    this.editingTeamId = null;
    this.resetAllEnergy();
    this.notify();
  }

  // Set filter value
  setFilter(filterKey, value) {
    if (this.filters.hasOwnProperty(filterKey)) {
      this.filters[filterKey] = value;
      this.notify();
    }
  }

  // Get filtered characters
  getFilteredCharacters() {
    return this.characters.filter(c => {
      // Search
      if (this.filters.search) {
        const query = this.filters.search.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(query);
        const matchesRaw = c.rawName.toLowerCase().includes(query);
        const matchesAttr = c.attribute.toLowerCase().includes(query);
        const matchesWeapon = c.weapon.toLowerCase().includes(query);
        if (!matchesName && !matchesRaw && !matchesAttr && !matchesWeapon) {
          return false;
        }
      }

      // Attribute filter
      if (this.filters.attribute !== 'ALL' && c.attribute !== this.filters.attribute) {
        return false;
      }

      // Weapon filter
      if (this.filters.weapon !== 'ALL' && c.weapon !== this.filters.weapon) {
        return false;
      }

      // Rarity filter
      if (this.filters.rarity !== 'ALL') {
        const targetRarity = parseInt(this.filters.rarity, 10);
        if (c.rarity !== targetRarity) return false;
      }

      // Energy status filter
      if (this.filters.energyStatus === 'AVAILABLE' && c.currentEnergy <= 0) {
        return false;
      }
      if (this.filters.energyStatus === 'EMPTY' && c.currentEnergy > 0) {
        return false;
      }

      return true;
    });
  }
}

export const state = new AppState();
