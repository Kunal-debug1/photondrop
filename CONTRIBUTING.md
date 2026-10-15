# Contributing to PhotonDrop

Thanks for helping improve PhotonDrop. Bug reports, clear reproduction steps, and carefully scoped pull requests are welcome.

## Before opening an issue

- Check existing issues for the same problem.
- For transfer or camera problems, include device model, OS, browser and version, whether both devices were online when the app was first opened, and the chunk-size/frame-rate settings.
- Never attach private files or include personal data. Use a harmless sample file.

## Development setup

Requirements: Node.js 20 or newer.

```sh
npm ci
npm run dev
```

Run the automated checks before opening a pull request:

```sh
npm test
npm run build
```

## Pull requests

- Keep changes focused and explain the user-visible problem they solve.
- Add or update tests for protocol and reconstruction behavior when relevant.
- Describe manual browser/device checks separately from automated test results.
- Do not claim that desktop checks prove camera compatibility on phones.
- Avoid adding dependencies unless the change needs them.

For changes to camera behavior or QR transfer settings, include the device/browser combinations tested and any limitations you observed.
