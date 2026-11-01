# Third-party notices

## pygame-ce 2.5.8

RECALL//ZERO uses pygame-ce 2.5.8, an SDL-based multimedia library distributed under the GNU Lesser General Public License, version 2.1 or (at your option) any later version.

- Project: https://github.com/pygame-community/pygame-ce
- Exact release source: https://github.com/pygame-community/pygame-ce/releases/tag/2.5.8
- License text: https://github.com/pygame-community/pygame-ce/blob/2.5.8/docs/LGPL.txt
- Bundled dependency licenses: https://github.com/pygame-community/pygame-ce/tree/2.5.8/docs/licenses

The Windows release is distributed as a one-folder build so pygame-ce and its native dependencies remain separate files. Reverse engineering for the purpose of debugging modifications to the LGPL-covered library is not prohibited by this project.

The release build copies the exact pygame-ce source archive, LGPL text, and dependency notices into its `THIRD_PARTY_NOTICES` folder. RECALL//ZERO does not modify pygame-ce. See `RELINKING.md` in that folder for replacement instructions.

## PyInstaller 6.22.3

PyInstaller is used only to produce the Windows distribution. Its GPL license includes a Bootloader Exception permitting generated application bundles to use the application's own license.

- Project: https://pyinstaller.org/
- License and exception: https://github.com/pyinstaller/pyinstaller/blob/v6.22.3/COPYING.txt

The release includes the exact PyInstaller 6.22.3 license and Bootloader Exception text used by the build.

## Python 3.12

The Windows distribution includes the CPython 3.12 runtime. Its exact `LICENSE.txt` is included in the release notices.

- Project: https://www.python.org/
- License: https://docs.python.org/3/license.html
