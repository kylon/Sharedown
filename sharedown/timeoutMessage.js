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

class timeoutMessage {
    #elm;
    #tm;

    constructor(elem) {
        this.#elm = elem;
    }

    reset() {
        this.#elm.classList.add('d-none');
        clearTimeout(this.#tm);
    }

    show() {
        if (!this.#elm.classList.contains('d-none'))
            return;

        const $this = this;

        this.#elm.classList.remove('d-none');
        this.#tm = setTimeout(function () {
            $this.reset();
        }, 1000);
    }
}