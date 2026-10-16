---
version: 1
---
## Book outline

This document uses the existing manuscript content type as a chapter plan. Chapter headings and ordered doc links determine assembly order. The visual outline editor edits those same headings and links; it is not a second outline format. Brief and research context belong in the attached brief, not in chapter-source lists unless their text is deliberately part of the book.

The Files selection action, Create book outline from selection, shows selected document names in order. The writer names chapters and adds the selected documents under them; creating an outline does not immediately compile or alter the sources. The outline UI supports chapter management, document selection and reordering.

Building the manuscript uses accepted source text and a review of the saved outline. Pending source edits are excluded. A changed outline or source invalidates a previously reviewed build. Existing manuscripts are reused and opened; another manuscript requires the existing explicit build-another flow. Empty or missing chapter sources remain visible instead of being silently filled.

After the first build, outline changes do not synchronize into the manuscript. Newly drafted chapters can be added through add_chapter_to_manuscript as pending changes. Editing already assembled prose happens in the Manuscript.
