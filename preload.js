// @ts-check
/**
 * FL Studio Clone — Electron Preload Context Bridge
 * Exposes native desktop file system and pro audio capabilities to the renderer window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,

  // App Metadata
  getInfo: () => ipcRenderer.invoke('app:get-info'),

  // Project File System (Native Dialogs)
  saveProject: (data, defaultName = 'MySong.beyou') => {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return ipcRenderer.invoke('dialog:save-file', {
      defaultName,
      content: jsonStr,
      filterType: 'project'
    });
  },

  openProjectDialog: () => ipcRenderer.invoke('dialog:open-project-dialog'),

  // Audio File Export / Import
  exportAudioFile: (arrayBuffer, defaultName = 'ExportedTrack.wav') => {
    return ipcRenderer.invoke('dialog:save-file', {
      defaultName,
      content: arrayBuffer,
      filterType: 'audio'
    });
  },

  importAudioDialog: () => ipcRenderer.invoke('dialog:import-audio-dialog'),

  // Event Listeners from Native Menu
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', handler);
    return () => ipcRenderer.removeListener('menu:action', handler);
  },

  onMenuTab: (callback) => {
    const handler = (_event, tab) => callback(tab);
    ipcRenderer.on('menu:tab', handler);
    return () => ipcRenderer.removeListener('menu:tab', handler);
  },

  onLoadProject: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('project:load-data', handler);
    return () => ipcRenderer.removeListener('project:load-data', handler);
  },

  onAudioImported: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('audio:imported', handler);
    return () => ipcRenderer.removeListener('audio:imported', handler);
  }
});

