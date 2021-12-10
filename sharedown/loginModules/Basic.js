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

const InputType = (() => {
   return Object.freeze({
       Text: 'text',
       Password: 'password',
       Email: 'email',
       Number: 'number'
   });
})();

/**
 * Extend this class to implement your login module
 *
 * see https://github.com/kylon/Sharedown/wiki/How-to-create-your-own-Login-Module
 */
class Basic {
    #fields = [];

    constructor() {}

    getFields() {
        return this.#fields;
    }

    getFieldsCount() {
        return this.#fields.length;
    }

    /**
     * @param sharedownUIInputLabel string
     * @param inptType InputType
     * @param sharedownUIInputDescription string
     */
    registerField(sharedownUIInputLabel, inptType= InputType.Text, sharedownUIInputDescription = '') {
        this.#fields.push({type: inptType, label: sharedownUIInputLabel, desc: sharedownUIInputDescription});
    }

    /**
     * Login module logic - override this in your module subclass
     *
     * @param puppeteerPage
     * @param loginData
     */
    async doLogin(puppeteerPage, loginData) {}
}

module.exports.BasicLogin = Basic;
module.exports.InputType = InputType;