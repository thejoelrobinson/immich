---
aliases: 
tags: 
date created: Monday, September 29th 2025, 9:32:02 pm
date modified: Monday, September 29th 2025, 9:35:37 pm
---

# Coding Excellence Standards

## Core Principles

### 1. Write for Humans First

Code is read far more often than written. Optimize for readability and understanding. Clear code > clever code.

### 2. Make It Work, Make It Right, Make It Fast

In that order. Correct functionality first, clean structure second, performance optimization third (and only when measured).

### 3. Fail Fast, Fail Clearly

Validate inputs early. Provide meaningful error messages. Make invalid states unrepresentable when possible.

### 4. Build on Solid Foundations

**Never build on untested code.** Verify each piece works before adding complexity. Small verified steps are faster than big leaps with backtracking.

### 5. Automate Quality Checks

Let tools catch mistakes before they become problems. Use linters, formatters, type checkers, and automated tests.

## Code Quality

### Structure & Organization

**Single Responsibility**
- Each function does one thing well
- If you need "and" to describe it, consider splitting

**Keep Functions Small**
- Target 20-30 lines for most functions
- Extract complex logic into well-named helpers
- If it doesn't fit on screen, it's probably too complex

**Logical File Organization**
- Group related functionality
- Separate concerns (UI, business logic, utilities, types)
- Keep files focused and cohesive
- Avoid circular dependencies

### Naming

Be descriptive and searchable:

```javascript
// ❌ Bad
const d = new Date();
const u = users.filter(x => x.a > 18);

// ✅ Good
const currentDate = new Date();
const adultUsers = users.filter(user => user.age > 18);
```

Use intention-revealing names:

```javascript
// ❌ Bad
function calc(x, y) { return x * 0.1 + y; }

// ✅ Good
function calculateTotalWithTax(subtotal, tax) {
  return subtotal * TAX_RATE + tax;
}
```

### Error Handling

**Never ignore errors.** Always handle them appropriately:

```javascript
// ❌ Bad - silent failure
try {
  functionThatMightThrow();
} catch (error) {
  // Nothing
}

// ✅ Good - handle meaningfully
try {
  functionThatMightThrow();
} catch (error) {
  logger.error('Failed to process request', { error, context });
  // Retry, fallback, or propagate
}
```

Provide context in error messages:
```javascript
throw new Error(`Failed to fetch user ${userId}. API returned ${response.status}`);
```

## Testing

### Test As You Go

**Don't move to the next feature until current code is verified:**

1. Write the function
2. Test it immediately (console.log, debugger, or test runner)
3. Verify edge cases work
4. Only then move forward

```javascript
// ✅ Good workflow
function calculateDiscount(price, discountPercent) {
  if (price <= 0) throw new Error('Price must be positive');
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100');
  }
  return price * (1 - discountPercent / 100);
}

// Test immediately
console.log(calculateDiscount(100, 20)); // Expected: 80
console.log(calculateDiscount(50, 0));   // Expected: 50

// Write formal tests
test('applies discount correctly', () => {
  expect(calculateDiscount(100, 20)).toBe(80);
});

// NOW move to next function
```

### Testing Principles

- **Test behavior, not implementation**
- Test critical functionality - you're not chasing coverage percentages
- Write tests before fixing bugs
- Keep tests independent and idempotent
- Use descriptive test names

### Test Structure (AAA Pattern)

```javascript
test('creates user with valid data', async () => {
  // Arrange
  const userData = { name: 'John', email: 'john@example.com' };
  
  // Act
  const user = await userService.create(userData);
  
  // Assert
  expect(user).toMatchObject(userData);
  expect(user.id).toBeDefined();
});
```

## Documentation

### Self-Documenting Code First

```javascript
// ❌ Bad - needs comment to explain
// Check if user can edit
if (user.role === 'admin' || user.id === resource.ownerId) {

// ✅ Good - self-explanatory
const canEdit = isAdmin(user) || isResourceOwner(user, resource);
if (canEdit) {
```

### When to Add Comments

- **WHY** decisions were made (not WHAT code does)
- Complex algorithms or business rules
- Workarounds (link to issue tracker)
- Public API documentation

```javascript
// ✅ Good comment
// Retry 3 times because external API occasionally returns 503 
// during their maintenance windows (2-3 seconds typically)
const MAX_RETRIES = 3;
```

## Before Code Review

### Pre-Submission Checks

```bash
npm run lint      # Fix all errors
npm run format    # Apply formatting
npm run test      # All pass
npm run build     # Succeeds
```

### Verify

- [ ] No debug statements or console.logs
- [ ] No commented-out code
- [ ] Error cases handled
- [ ] Critical paths tested
- [ ] Complex logic has tests

### Review Focus

1. **Correctness** - Does it solve the problem?
2. **Security** - Inputs validated? SQL injection prevented?
3. **Performance** - Unnecessary loops or queries?
4. **Maintainability** - Will others understand this?
5. **Edge Cases** - What happens with null/empty/invalid inputs?

## Modern Patterns

### Immutability

```javascript
// ❌ Bad - mutating
function addItem(cart, item) {
  cart.items.push(item);
  return cart;
}

// ✅ Good - immutable
function addItem(cart, item) {
  return {
    ...cart,
    items: [...cart.items, item]
  };
}
```

### Async/Await

```javascript
async function fetchUserData(userId) {
  try {
    const user = await api.getUser(userId);
    const permissions = await api.getPermissions(user.roleId);
    return { user, permissions };
  } catch (error) {
    throw new Error(`Failed to fetch user data: ${error.message}`);
  }
}
```

### Type Safety - Use TypeScript

**Strong preference for TypeScript** - catches errors at build time, better IDE support, self-documenting:

```typescript
interface UserInput {
  email: string;
  password: string;
  role?: 'admin' | 'user';
}

function createUser(input: UserInput): Promise<User> {
  // Full type safety
}
```

If TypeScript isn't available, use JSDoc as fallback.

## Architecture Patterns

### Frontend

- **Component Purity** - Same inputs → same outputs
- **State Management** - Lift state to appropriate level
- **Separation of Concerns** - Presentation vs business logic
- **Accessibility** - Semantic HTML, ARIA, keyboard navigation
- **Performance** - Lazy loading, memoization when measured

### Backend

- **Consistent Error Responses** - Proper HTTP status codes
- **Validate at the Edge** - API entry points
- **Middleware** - Cross-cutting concerns (auth, logging, rate limiting)
- **Idempotency** - Operations should be safely retryable
- **Graceful Degradation** - Handle external failures without crashing

### Data Layer

- **Transactions** - For operations that must be atomic
- **Query Optimization** - Avoid N+1 queries, use indexes
- **Connection Pooling** - Reuse connections efficiently
- **Schema Migrations** - Version control all changes

## Security & Dependencies

### Security First

- Never commit secrets (use environment variables)
- Validate and sanitize all inputs
- Use parameterized queries for databases
- Apply principle of least privilege
- Encrypt sensitive data at rest and in transit

### Dependencies

- Minimize dependencies - each is a potential risk
- Document why each dependency exists

## Performance

### Measure Before Optimizing

- Profile to identify actual bottlenecks
- Optimize algorithm before implementation
- Cache expensive operations appropriately

### Database Example

```javascript
// ❌ Bad - N+1 queries
const users = await getUsers();
for (const user of users) {
  user.posts = await getPostsByUserId(user.id);
}

// ✅ Good - single query with join
const usersWithPosts = await getUsersWithPosts();
```

## The Boy Scout Rule

**Leave code better than you found it.**
- Fix small issues as you encounter them
- Update outdated patterns when touching old code
- Improve test coverage incrementally

---

_These are guidelines, not rigid rules. Use judgment and prioritize based on context. The goal is sustainable, reliable software._