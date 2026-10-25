# Changes waiting for the next release

Each pull request with a user-visible change adds **one file here** instead of editing `CHANGELOG.md`, so pull requests don't conflict with each other. Name it after the change (`pin-rooms.md`), and write it like the CHANGELOG: a group heading, then the entries, for the people using the app.

```markdown
### Added

- **Pin and rename your rooms.** Right-click a recent room to pin it to the top or give it a name of your own.
```

The groups are `### Added`, `### Changed`, `### Fixed` and `### Removed`; one file can have several. Internal changes (refactors, tests, docs) don't need one.

`npm run release` gathers the files into the version's section of `CHANGELOG.md`, in the order they were added, and deletes them (see [releasing](../docs/en-US/development.md#releasing)). The tests check that every file here reads correctly.
