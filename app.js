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

const { app, ipcMain, dialog, Menu, BrowserWindow } = require('electron');
const menu = Menu.buildFromTemplate([
    {
        label: 'File',
        submenu: [
            { mact: 'odlfold', label: 'Open output folder', click: menuOnClick },
            { mact: 'ologsfold', label: 'Open logs folder', click: menuOnClick },
            { mact: 'aexit', label: 'Quit', click: menuOnClick },
        ]
    },
    {
        label: 'Sharedown',
        submenu: [
            { mact: 'owiki', label: 'Open Wiki (external)', click: menuOnClick },
            { mact: 'osrc', label: 'Open repository (external)', click: menuOnClick },
        ]
    },
    {
        mact: 'about', label: 'About', click: menuOnClick
    }
]);
const path = require('path');
let mainW = null;

Menu.setApplicationMenu(menu);

function createWindow () {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            devTools: false,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.loadFile('sharedown/sharedown.html');
    win.setResizable(false);

    return win;
}

function menuOnClick(item, window, e) {
    mainW.webContents.send('appmenu', {cmd: item.mact});
}

app.whenReady().then(() => {
    mainW = createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            mainW = createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
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

ipcMain.on('sharedown-async', (e, args) => {
    switch (args.cmd) {
        case "showabout": {
            const win = new BrowserWindow({
                width: 350,
                height: 230,
                webPreferences: {
                    devTools: false,
                }
            })

            win.loadFile('sharedown/about.html');
            win.setMenuBarVisibility(false);
            win.setResizable(false);
            win.setSkipTaskbar(true);
            win.setParentWindow(mainW);
            mainW.setEnabled(false);

            win.once('closed', () => mainW.setEnabled(true));
        }
            break;
        default:
            break;
    }
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
        case "getAppDataPath": {
            e.returnValue = app.getPath('appData');
        }
            break;
        case "getDownloadsPath": {
            e.returnValue = app.getPath('downloads');
        }
            break;
        case "quit": {
            app.quit();
            e.returnValue = true;
        }
            break;
        default:
            e.returnValue = undefined;
            break;
    }
});