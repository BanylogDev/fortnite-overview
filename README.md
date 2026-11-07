# Fortnite Overview

## What you need

- Windows
- An internet connection

## Run it

1. Open this folder.
2. Double-click **Run** (`Run.bat`).
3. Sign in to Epic Games in the browser window that opens.
4. Leave the Epic browser page visible briefly. The app captures it, brings the command window back, and checks the code with Epic. It retries automatic reading up to three times. It plays a sound and prints green when accepted or red if all attempts fail. If needed, paste a fresh authorization code into the command window. Screenshots are not saved.
5. Wait for the locker images to finish generating.

Your generated images will be saved in the **images** folder beside **Run**. Large locker images are resized to a maximum edge of 3072 pixels to reduce file size. If Node.js 22+ and npm are missing, **Run** downloads the official portable Node.js runtime (including npm) into **Engine\Runtime** and then continues. The first run may take longer while the runtime, required packages, or OCR language data are downloaded.

Keep the **Engine** folder beside **Run**. It contains the program and its required files.
