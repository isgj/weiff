# Using Weiff

Weiff is meant for local, day-to-day work with Jujutsu repositories. Start it, open a repository, and use the browser UI for the parts of `jj` work that benefit from a visual view.

## Start the app

```sh
npm ci --prefix web
npm run build
./dist/weiff
```

Open [http://127.0.0.1:7000](http://127.0.0.1:7000).

## Work with repositories

Add the repository roots you use often, then switch between them from the app. Weiff remembers the repository list, custom names, the current repository, and the log revset.

On Linux, the default configuration file is `~/.config/weiff/config.json`.

## Review changes

Use the commit graph to browse revisions and open change details. From there you can inspect file diffs, switch between inline and side-by-side views, and check related information such as bookmarks, conflicts, and evolution history.

The revset filter lets you narrow the graph without leaving the app.

Changed files and diff sections have restore actions. Restoring reverses the selected change in the current working copy; it does not rewrite the selected historical revision. Review the resulting working-copy diff before committing it.

## Browse repository files

Open **Files** to explore the current working-copy tree. Select a directory to see its immediate files and subdirectories, or select a file to open a syntax-highlighted preview with line numbers.

To browse an older revision, open a commit's action menu in the graph and choose **Show files**. The Files item in the main navigation always returns to the current working copy.

The breadcrumb returns to any parent directory. The current path and selected revision are kept in the page URL, so refreshing the browser or sharing a local link opens the same directory or file again.

Files shows the repository content known to Jujutsu. Ignored build output and Jujutsu's internal metadata are not included, and binary or very large files are identified instead of rendered as text.

## Manage daily `jj` work

Weiff supports common bookmark and workspace actions:

- Create, update, delete, and push bookmarks.
- Create, open, and forget workspaces.
- Restore an operation from the operation log.
- Undo the latest operation when you need to step back.

Long operation histories load in pages. Use **Load older** at the end of the log when the operation you need is not in the first page.

## Choose display preferences

Settings keeps the color theme and default diff layout in one place. The diff toolbar can still switch a single review between inline and side-by-side layouts.

## Keep it local

Weiff does not provide authentication. Run it for yourself on `127.0.0.1`, and do not expose it to people you would not trust with the repositories and files available to your operating-system user.
