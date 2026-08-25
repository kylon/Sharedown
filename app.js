/**
 * This file is part of the Sharedown (https://github.com/kylon/Sharedown).
 * Copyright (c) 2021 Kylon.
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

const { app, ipcMain, dialog, Menu, BrowserWindow, clipboard } = require('electron');
const path = require('node:path');
let mainW = null;

function createWindow () {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 350,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: true,
            spellcheck: false,
            devTools: false,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.loadFile('sharedown/sharedown.html');
    win.setResizable(true);

    return win;
}

app.whenReady().then(() => {
    mainW = createWindow();

    Menu.setApplicationMenu(null);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            mainW = createWindow();
    });
});

ipcMain.on('showMessage', (e, args) => {
    let btns = [];

    switch (args.type) {
        case 'question': {
            btns.push('Cancel');
            btns.push('OK');
        }
            break;
        default:
            break;
    }

    e.returnValue = dialog.showMessageBoxSync(mainW, {
        message: args.m,
        type: args.type ?? 'error',
        title: args.title ?? 'Sharedown',
        buttons: btns
    });
});

ipcMain.on('sharedown-sync', (e, args) => {
    switch (args.cmd) {
        case "selectFoldDialog": {
            e.returnValue = dialog.showOpenDialogSync(mainW, {
                title: 'Select video output directory',
                properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
                message: 'Output video folder',
            });
        }
            break;
        case "selectChromeBinDialog": {
            e.returnValue = dialog.showOpenDialogSync(mainW, {
                title: 'Select Chrome/Chromium executable path',
                properties: ['openFile'],
                message: 'Chrome/Chromium executable path',
            });
        }
            break;
        case "getAppDataPath": {
            e.returnValue = app.getPath('appData');
        }
            break;
        case "getDownloadsPath": {
            e.returnValue = app.getPath('downloads');
        }
            break;
        case "clipboard": {
            clipboard.writeText(args.str);
            e.returnValue = true;
        }
            break;
        default:
            e.returnValue = undefined;
            break;
    }
});
