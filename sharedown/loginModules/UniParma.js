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

const basic = require('./Basic');

class UniParma extends basic.BasicLogin {
    constructor() {
        super();
        this.registerField('Email', basic.InputType.Text, 'Email provied by your university');
        this.registerField('Password', basic.InputType.Password);
    }

    async doLogin(puppeteerPage, loginData) {
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});
        await puppeteerPage.waitForSelector('input[type="email"]');
        await puppeteerPage.focus('input[type="email"]');
        await puppeteerPage.evaluate(() => document.querySelector('input[type="email"]').value = '');
        await puppeteerPage.keyboard.type(loginData.field0);
        await puppeteerPage.click('input[type="submit"]')
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});

        await puppeteerPage.waitForSelector('input[id="userNameInput"]');
        await puppeteerPage.focus('input[id="userNameInput"]');
        await puppeteerPage.evaluate(() => document.querySelector('input[id="userNameInput"]').value = '');
        await puppeteerPage.keyboard.type(loginData.field0);

        await puppeteerPage.waitForSelector('input[id="passwordInput"]');
        await puppeteerPage.focus('input[id="passwordInput"]');
        await puppeteerPage.evaluate(() => document.querySelector('input[id="passwordInput"]').value = '');
        await puppeteerPage.keyboard.type(loginData.field1);

        await puppeteerPage.click('span[id="submitButton"]');
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});

        if ((await puppeteerPage.$('input[id="idBtn_Back"]')) !== null) {
            await puppeteerPage.waitForSelector('input[id="idBtn_Back"]', {timeout: 6000});
            await puppeteerPage.focus('input[id="idBtn_Back"]');
            await puppeteerPage.click('input[id="idBtn_Back"]');
        }
    }
}

module.exports = UniParma;
