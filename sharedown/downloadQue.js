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

class downloadQue {
    #list = [];

    addVideo(video) {
        this.#list.push(video);
    }

    getQue() {
        return this.#list;
    }

    getNext() {
        if (this.#list.length === 0)
            return null;

        return this.#list.shift();
    }

    hasNext() {
        return this.#list.length > 0;
    }

    getByID(id) {
        for (const v of this.#list) {
            if (v.id === id)
                return v;
        }

        return null;
    }

    remove(id) {
        let i = 0;

        for (const v of this.#list) {
            if (v.id === id)
                break;

            ++i;
        }

        if (i < this.#list.length)
            this.#list.splice(i, 1);
    }

    exportDownloadQue() {
        const ret = [];

        for (const v of this.#list)
            ret.push(JSON.stringify(v));

        return ret;
    }

    importDownloadQue(videolist) {
        if (!Array.isArray(videolist))
            return;

        try {
            for (const v of videolist) {
                const vdata = JSON.parse(v);

                if (vdata && vdata.hasOwnProperty('url') && vdata.hasOwnProperty('settings'))
                    this.#list.push(new video(vdata.url, vdata.settings));
            }

            return true;
        } catch (e) {}

        return false;
    }
}