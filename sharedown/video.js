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

class video {
    id;
    url;
    settings = {
        _version: 1, // internal
        saveas: '',
        outputPath: ''
    };

    constructor(url, settings = null) {
        this.url = url;

        if (settings !== null) {
            this.settings.saveas = settings.saveas ?? '';
            this.settings.outputPath = settings.outputPath ?? ''
        }

        this.#generateId();
        Object.freeze(this);
    }

    #generateId() {
        this.id = window.sharedown.genID();
    }
}