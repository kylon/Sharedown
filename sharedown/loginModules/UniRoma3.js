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

class UniRoma3 extends basic.BasicLogin {
    constructor() {
        super();
        this.registerField('Username', basic.InputType.Email, 'email universitaria @stud.uniroma3.it');
        this.registerField('Password', basic.InputType.Password, 'password dell\'account');
    }

    async doLogin(puppeteerPage, loginData) {
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});
        await puppeteerPage.waitForSelector('input[type="email"]');
        await puppeteerPage.focus('input[type="email"]');
        await puppeteerPage.keyboard.type(loginData.field0);
        await puppeteerPage.keyboard.press('Enter');
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});
        await this.waitForTimeout(3000) // necessario per far aggiornare la pagina con la maschera per la pwd
        await puppeteerPage.waitForSelector('input[type="password"]');
        await puppeteerPage.focus('input[type="password"]');
        await puppeteerPage.keyboard.type(loginData.field1);
        await puppeteerPage.click('[type="submit"]');
        await puppeteerPage.waitForNavigation({waitUntil: 'networkidle2'});      
    }
}

module.exports = UniRoma3;
