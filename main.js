// @ts-check
/**
 * FL Studio Clone — Native Desktop Application Main Process
 * Electron architecture engineered for high-performance low-latency pro audio.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Audio & Real-time DAW Chromium Flags ──────────────────────────────
// Disable throttling when window is backgrounded/minimized so audio never glitches or drops buffers
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Remove autoplay restrictions completely in desktop app mode
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Force highest priority audio thread scheduling
app.commandLine.appendSwitch('enable-exclusive-audio');
app.commandLine.appendSwitch('high-dpi-support', '1');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'FL Studio Web DAW — Desktop Edition',
    backgroundColor: '#121214',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false // Keep Web Audio synthesis running full speed in background
    },
    show: false
  });

  // Load the web app
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Handle external link openings safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createApplicationMenu();
}

// ── Native Application Menu with Pro DAW Hotkeys ─────────────────────
function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  /** @type {Array<Electron.MenuItemConstructorOptions>} */
  const template = [
    ...(isMac ? [{
      label: 'FL Studio Clone',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:action', 'preferences')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:action', 'new-project')
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenProjectDialog()
        },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:action', 'save-project')
        },
        {
          label: 'Save Project As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:action', 'save-project-as')
        },
        { type: 'separator' },
        {
          label: 'Import Audio / Sample...',
          accelerator: 'CmdOrCtrl+I',
          click: () => handleImportAudioDialog()
        },
        {
          label: 'Sample Library / Presets',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('menu:action', 'open-library')
        },
        { type: 'separator' },
        {
          label: 'Export Master WAV...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:action', 'export-wav')
        },
        {
          label: 'Export Track Stems...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:action', 'export-stems')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:action', 'undo')
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => mainWindow?.webContents.send('menu:action', 'redo')
        },
        { type: 'separator' },
        {
          label: 'Clear Current Pattern',
          accelerator: 'CmdOrCtrl+Delete',
          click: () => mainWindow?.webContents.send('menu:action', 'clear-pattern')
        },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Channel Rack (Beat)',
          accelerator: 'F6',
          click: () => mainWindow?.webContents.send('menu:tab', 'channel-rack')
        },
        {
          label: 'Piano Roll (Melody)',
          accelerator: 'F7',
          click: () => mainWindow?.webContents.send('menu:tab', 'piano-roll')
        },
        {
          label: 'Playlist (Song Arrange)',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu:tab', 'playlist')
        },
        {
          label: 'Multi-Track Mixer',
          accelerator: 'F9',
          click: () => mainWindow?.webContents.send('menu:tab', 'mixer')
        },
        {
          label: 'Audio Editor',
          accelerator: 'F8',
          click: () => mainWindow?.webContents.send('menu:tab', 'audio-editor')
        },
        { type: 'separator' },
        {
          label: 'Parametric EQ',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('menu:action', 'toggle-eq')
        },
        {
          label: 'Soundgoodizer',
          accelerator: 'CmdOrCtrl+G',
          click: () => mainWindow?.webContents.send('menu:action', 'toggle-soundgoodizer')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play / Pause',
          accelerator: 'Space',
          click: () => mainWindow?.webContents.send('menu:action', 'toggle-play')
        },
        {
          label: 'Stop & Reset',
          accelerator: 'CmdOrCtrl+.',
          click: () => mainWindow?.webContents.send('menu:action', 'stop-play')
        },
        {
          label: 'Record / Arms',
          accelerator: 'R',
          click: () => mainWindow?.webContents.send('menu:action', 'toggle-record')
        },
        {
          label: 'Toggle Metronome',
          accelerator: 'M',
          click: () => mainWindow?.webContents.send('menu:action', 'toggle-metronome')
        },
        { type: 'separator' },
        {
          label: 'Switch to Pattern Mode',
          click: () => mainWindow?.webContents.send('menu:action', 'mode-pattern')
        },
        {
          label: 'Switch to Song Mode',
          click: () => mainWindow?.webContents.send('menu:action', 'mode-song')
        }
      ]
    },
    {
      label: 'AI Studio',
      submenu: [
        {
          label: 'Open Max AI Co-Pilot',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:action', 'open-copilot')
        },
        {
          label: 'Generate AI Beat',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:action', 'ai-beat')
        },
        {
          label: 'Generate AI Melody',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow?.webContents.send('menu:action', 'ai-melody')
        },
        {
          label: 'Auto-Arrange Song (48 Bars)',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('menu:action', 'auto-arrange')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── Native File Dialog Handlers ─────────────────────────────────────
async function handleOpenProjectDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open FL Studio Project',
    filters: [
      { name: 'FL Studio Clone Project (*.beyou, *.json)', extensions: ['beyou', 'json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      mainWindow.webContents.send('project:load-data', {
        filePath,
        fileName: path.basename(filePath),
        data: JSON.parse(content)
      });
    } catch (err) {
      dialog.showErrorBox('Failed to Open Project', `Error loading ${filePath}:\n${err.message}`);
    }
  }
}

async function handleImportAudioDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Audio Sample',
    filters: [
      { name: 'Audio Files (*.wav, *.mp3, *.ogg, *.flac)', extensions: ['wav', 'mp3', 'ogg', 'flac'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const buffer = fs.readFileSync(filePath);
      mainWindow.webContents.send('audio:imported', {
        filePath,
        fileName: path.basename(filePath),
        buffer: buffer.buffer
      });
    } catch (err) {
      dialog.showErrorBox('Audio Import Failed', `Could not read file:\n${err.message}`);
    }
  }
}

// ── IPC Listeners for Native Desktop Actions ────────────────────────
ipcMain.handle('app:get-info', () => ({
  name: 'FL Studio Clone Desktop',
  version: '2.0.0-desktop',
  platform: process.platform,
  isDesktop: true
}));

ipcMain.handle('dialog:save-file', async (_event, { defaultName, content, filterType = 'project' }) => {
  if (!mainWindow) return { canceled: true };

  const filters = filterType === 'audio'
    ? [{ name: 'Wave Audio File (*.wav)', extensions: ['wav'] }]
    : [{ name: 'FL Studio Project (*.beyou)', extensions: ['beyou'] }, { name: 'JSON (*.json)', extensions: ['json'] }];

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save File',
    defaultPath: defaultName || 'Project.beyou',
    filters
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    if (typeof content === 'string') {
      fs.writeFileSync(result.filePath, content, 'utf-8');
    } else if (Buffer.isBuffer(content)) {
      fs.writeFileSync(result.filePath, content);
    } else {
      fs.writeFileSync(result.filePath, Buffer.from(content));
    }
    return { canceled: false, filePath: result.filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

ipcMain.handle('dialog:open-project-dialog', async () => {
  await handleOpenProjectDialog();
});

ipcMain.handle('dialog:import-audio-dialog', async () => {
  await handleImportAudioDialog();
});

// App Lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

