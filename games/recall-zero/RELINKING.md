# Replacing pygame-ce in the Windows build

RECALL//ZERO ships as a one-folder application. The LGPL-covered pygame-ce library and its native dependencies remain separate files under the distribution's `_internal` folder; the executable does not enforce signatures on them.

To test a modified, API-compatible build of pygame-ce 2.5.8:

1. Build pygame-ce for CPython 3.12 on 64-bit Windows from the bundled `pygame-ce-2.5.8-source.zip` archive.
2. Make a backup copy of the RECALL//ZERO folder.
3. Replace the packaged pygame-ce module and its corresponding native library files under `_internal` with the modified build, preserving their relative paths and filenames.
4. Start `RecallZero.exe` from that copied folder and manually verify the title, throw/recall, dash, and pause flows.

Reverse engineering for the limited purpose of debugging modifications to the LGPL-covered library is not prohibited. RECALL//ZERO contains no local modifications to pygame-ce.
