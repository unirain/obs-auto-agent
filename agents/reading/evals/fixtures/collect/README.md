# Source probe fixtures

Sampled read-only on 2026-10-13 from `https://www.langchain.com/blog` and `https://claude.com/resources`; extractor version `web-directory-v1`. Fixtures retain only six item structures, titles, dates and article links. They do not establish long-term source availability.

LangChain currently uses `.blog-list.is-normal .blog-item`, a `blog-link-absolute` article link, date text and an actual `w-pagination-next` query link. Claude currently uses ResourceCard links, including external official articles and unsupported webinar/video entries. Its homepage did not expose a historical next-page link, so the first scan records a coverage gap; actual successful read and historical gap resolution remain separate.

The live harness must archive request times and actual pagination coverage. A parser returning no matching items is a failure, never proof of an empty source.
