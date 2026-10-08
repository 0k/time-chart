# -*- mode: shell-script -*-
##
## Generates ``README.md`` from ``README.org`` for npmjs.com, which only
## renders Markdown, and appends the changelog to it: the README is the
## only document npmjs.com displays for a package.
##
## Needs ``pandoc`` and ``gitchangelog``.  Without them this step is
## skipped with a warning (a fresh clone can still build); the release
## pipeline sets ``AUTOGEN_STRICT=1`` which makes them mandatory.
##

if [ -f README.org ]; then
    depends_soft pandoc || {
        echo "README.md not regenerated (fine for building, required for release)." >&2
        return 0
    }
    ## npmjs.com shows YAML front-matter verbatim: emit the ``#+title:``
    ## as a level-1 heading instead, with sections one level below.
    title=$(sed -n 's/^#+title:[[:space:]]*//p' README.org)
    {
        [ -n "$title" ] && printf '# %s\n\n' "$title"
        pandoc README.org -f org -t gfm --shift-heading-level-by=1
    } > README.md.tmp || {
        rm -f README.md.tmp
        return 1
    }

    if depends_soft gitchangelog; then
        if [ ! -e .gitchangelog.rc ]; then
            echo "No .gitchangelog.rc found: changelog not appended to README.md." >&2
        else
            echo "" >> README.md.tmp
            echo "" >> README.md.tmp
            changelog=$(gitchangelog) || {
                rm -f README.md.tmp
                return 1
            }
            ## Nest the changelog under the README title.
            printf '%s\n' "$changelog" | sed 's/^#/##/' >> README.md.tmp
        fi
    fi

    if [ -f README.md ] && diff README.md README.md.tmp > /dev/null; then
        echo "No changes in README.md" >&2
        rm README.md.tmp
    else
        echo "Updating README.md" >&2
        mv README.md.tmp README.md
    fi
fi
