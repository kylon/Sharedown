/**
 * This file is part of the Sharedown (https://github.com/kylon/Sharedown).
 * Copyright (c) 2026 Kylon.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";

const {app, ipcMain, dialog, Menu, BrowserWindow, clipboard} = require('electron');
const nodepath = require('node:path');
const SHDMainCMD = require('./sharedown/enums/shdMainCMD');
const MessageType = require('./sharedown/enums/messageType');
let mainWindow = null;

function createWindow () {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 350,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: true,
            spellcheck: false,
            devTools: true,
            preload: nodepath.join(__dirname, 'preload.js')
        }
    });

    win.webContents.toggleDevTools();

    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('will-redirect', e => e.preventDefault());
    win.webContents.on('will-frame-navigate', e => e.preventDefault());
    win.webContents.on('will-attach-webview', e => e.preventDefault());

    win.webContents.setWindowOpenHandler((details) => {
        return {action: 'deny'};
    });

    win.loadFile(nodepath.join(__dirname, 'sharedown', 'sharedown.html'));
    return win;
}

app.whenReady().then(() => {
    mainWindow = createWindow();

    Menu.setApplicationMenu(null);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            mainWindow = createWindow();
    });
});

ipcMain.on('shdipcmain', (e, args) => {
    switch (args.cmd) {
        case SHDMainCMD.OutputDirDialog: {
            e.returnValue = dialog.showOpenDialogSync(mainWindow, {
                title: 'Select output directory',
                properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
                message: 'Output directory',
            });
        }
            break;
        case SHDMainCMD.CustomBrowserDialog: {
            e.returnValue = dialog.showOpenDialogSync(mainWindow, {
                title: 'Select custom browser executable path',
                properties: ['openFile'],
                message: 'Browser executable path',
            });
        }
            break;
        case SHDMainCMD.AppDataPath: {
            e.returnValue = app.getPath('appData');
        }
            break;
        case SHDMainCMD.DownloadPath: {
            e.returnValue = app.getPath('downloads');
        }
            break;
        case SHDMainCMD.Clipboard: {
            clipboard.writeText(args.str);
            e.returnValue = true;
        }
            break;
        case SHDMainCMD.MessageBox: {
            e.returnValue = dialog.showMessageBoxSync(mainWindow, {
                message: args.content,
                type: args.type,
                title: 'Sharedown',
                buttons: args.type === MessageType.Question ? ['OK', 'Cancel'] : ['OK']
            });
        }
            break;
        case SHDMainCMD.QuitApp: {
            app.exit();
        }
            break;
        default:
            e.returnValue = undefined;
            break;
    }
});
