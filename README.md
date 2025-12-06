![](sharedownlogo.png)

Sharedown is an Electron application to download Sharepoint videos, especially meant for students.

**We take NO responsibility for your actions, do not violate your tenant rules!**

### Sharedown Wiki
See [Sharedown Wiki](https://github.com/kylon/Sharedown/wiki) for more info or help!

### FAQs
> Q: I get a "Something went wrong..", or similar, error when Chrome/Chromium loads video previews.
>
> A: This is not an error, this is expected and has no impact in Sharedown.

### Requirements
* A recent version of FFmpeg
* YT-dlp - [releases](https://github.com/yt-dlp/yt-dlp/releases)
* Python 3
* [Yarn](https://yarnpkg.com/)
* A recent OS (Windows, Linux, or MacOS)

### Features
* Supports downloading with [FFmpeg](https://www.ffmpeg.org/) or [YT-dlp](https://github.com/yt-dlp/yt-dlp)
* Per-video settings
* Login modules to implement custom automatic login (see [Wiki](https://github.com/kylon/Sharedown/wiki))

### Install
* Download latest release from [here](https://github.com/kylon/Sharedown/releases/latest)
* Place Sharedown app in your preferred location

**ArchLinux**:

The official AUR package [sharedown](https://aur.archlinux.org/packages/sharedown/) is available.


Default output folder is your OS _**Downloads**_ folder, or, in Linux, if not found, your _**Home**_ folder.

### Build

Run the following commands in a terminal to build Sharedown.

```
$ git clone https://github.com/kylon/Sharedown.git
$ cd Sharedown
$ yarn install
$ yarn dist
```

### Run from source

Run the following commands in a terminal to run Sharedown from source.

```
$ git clone https://github.com/kylon/Sharedown.git
$ cd Sharedown
$ npm i
$ npm start
```

---

![](sharedown.jpg)
