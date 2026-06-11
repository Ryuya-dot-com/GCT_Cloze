# GCT Context Reading Activity

This directory contains the public GitHub Pages version of the GCT context
reading activity. The participant-facing copy is written for classroom and
exam-preparation use: learners first see strategy guidance for guessing unknown
words from context, then complete several short practice items before the main
task.

## Public Files

- `index.html`: learner-facing activity page.
- `assets/app.js`: activity behavior.
- `assets/styles.css`: visual styling.
- `config.js`: deployment settings.
- `data/cloze_items.csv`: public display items.

The public item file contains only the fields needed to display the activity:
item IDs, item version, a public blank label, and passages with the target
location replaced by `XXXX`-based placeholders. Clear inflectional or
derivational endings are retained as public placeholders, such as `XXXXed` and
`XXXXly`, so that the cloze norming task does not remove the syntactic cue that
the original GCT nonsense-word form provided.

The item file should be regenerated from the internal project files before
publication.

## Classroom Use

The opening screen now frames the task as unknown-word inference practice rather
than a research survey. It highlights three strategies learners can apply before
starting:

1. Understand the situation from surrounding sentences.
2. Use part of speech and word-form clues such as `XXXXed` and `XXXXly`.
3. List several plausible meanings before choosing the best fit.

For educational settings, instructors can use the activity as a short diagnostic,
pre/post exercise, or reading-strategy practice. Keep dictionaries, translation
tools, and web search unavailable during the task, then debrief selected items by
asking learners which context clues supported their guesses.

The default practice set combines four short items: broad context inference,
past-tense form (`XXXXed`), adverb form (`XXXXly`), and noun inference from a
cause-and-effect context. Deployments can replace these by setting
`practiceItems` in `config.js`.

## Deployment Settings

Before publishing, edit `config.js`:

```js
window.CLOZE_CONFIG = {
  submissionEmail: "researcher@example.com",
  emailSubject: "GCT Context Reading Activity Workbook Submission",
  autoDownloadWorkbook: true,
  enablePractice: true,
  requireParticipantId: true
};
```

The participant flow is:

1. Enter learner information.
2. Complete several practice items covering different context clues.
3. Complete the activity items by listing possible English completions and
   possible Japanese meanings.
4. Download the answer workbook automatically.
5. Submit the downloaded workbook if the instructor or researcher asks for it.

The generated workbook keeps the sheet structure concise:

1. `Summary`: learner/session metadata and simple completion statistics.
2. `Main Responses`: item-level English and Japanese response fields.
3. `Item Order`: the randomized item order shown to the learner.
4. `解答時間`: per-item first response time, total response time, visit count,
   revision flag, start time, and completion time.

`Summary` also records key implementation metadata such as the workbook schema
version, generated time, practice item count, practice completion status,
randomization setting, maximum item count, and item CSV path. This keeps the
workbook compact while preserving enough information to audit classroom or
research runs later.

Browsers cannot attach the Excel file to an email automatically, so participants
must attach the downloaded file manually.
