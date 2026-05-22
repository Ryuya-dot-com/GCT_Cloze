# GCT Cloze Survey

This directory contains the public GitHub Pages version of the cloze survey.

## Public Files

- `index.html`: survey page.
- `assets/app.js`: survey behavior.
- `assets/styles.css`: visual styling.
- `config.js`: deployment settings.
- `data/cloze_items.csv`: public display items.

The public item file contains only the fields needed to display the survey:
item IDs, item version, a public blank label, and passages with the target
location replaced by `XXXX`-based placeholders. Clear inflectional or
derivational endings are retained as public placeholders, such as `XXXXed` and
`XXXXly`, so that the cloze norming task does not remove the syntactic cue that
the original GCT nonsense-word form provided.

The item file should be regenerated from the internal project files before
publication.

## Deployment Settings

Before publishing, edit `config.js`:

```js
window.CLOZE_CONFIG = {
  submissionEmail: "researcher@example.com",
  emailSubject: "GCT Cloze Survey CSV Submission",
  autoDownloadCsv: true,
  enablePractice: true,
  requireParticipantId: true
};
```

The participant flow is:

1. Enter participant information.
2. Complete one practice item.
3. Complete the survey items by listing possible English completions and
   possible Japanese meanings.
4. Download the CSV automatically.
5. Attach the CSV to the prepared email and submit it.

Browsers cannot attach the CSV file to an email automatically, so participants
must attach the downloaded file manually.
