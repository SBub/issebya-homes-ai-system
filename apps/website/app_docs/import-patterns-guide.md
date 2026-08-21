# Import Patterns Guide

Use destructured imports instead of namespace imports for better tree-shaking and code clarity.

---

## Rule: Prefer Destructured Imports

**Don't** use namespace imports:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.captureException(error);
Sentry.setTag('key', 'value');
```

**Do** use destructured imports:

```typescript
import { captureException, setTag } from '@sentry/nextjs';

captureException(error);
setTag('key', 'value');
```

---

## Why?

| Benefit               | Explanation                               |
| --------------------- | ----------------------------------------- |
| Tree-shaking          | Bundlers can eliminate unused exports     |
| Explicit dependencies | Clear what functions a file actually uses |
| Smaller bundles       | Only imported code is included            |
| Better IDE support    | Autocomplete shows only imported items    |

---

## When This Applies

| Scenario                                | Import Style                                   |
| --------------------------------------- | ---------------------------------------------- |
| Using specific functions from a library | Destructured: `import { fn1, fn2 } from "lib"` |
| Library requires namespace import       | Namespace: `import * as Lib from "lib"` (rare) |
| Default export only                     | Default: `import Lib from "lib"`               |

---

## Examples

### Sentry

```typescript
// Before
import * as Sentry from '@sentry/nextjs';
Sentry.init({ dsn: '...' });
Sentry.captureException(error);

// After
import { init, captureException } from '@sentry/nextjs';
init({ dsn: '...' });
captureException(error);
```

### Generic Pattern

```typescript
// Before
import * as utils from '@/lib/utils';
utils.formatDate(date);
utils.parseJSON(str);

// After
import { formatDate, parseJSON } from '@/lib/utils';
formatDate(date);
parseJSON(str);
```
