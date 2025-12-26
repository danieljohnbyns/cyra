# Test Functions Directory

This folder is for **testing and development** of new tool functions before they are promoted to production.

## Workflow

When creating a new tool function:

1. **Study production functions first** - Read 2-3 sample functions from `../functions/` to understand:
   - The exact `CyraTool` interface implementation
   - How parameters are defined and validated
   - Error handling patterns used
   - Return value format and structure
   - Code style and naming conventions
   - Documentation standards

2. **Create the function here** - Develop the function in this folder following the patterns you learned:
   - Match the syntax exactly as shown in production functions
   - Use the same error handling approach
   - Follow the same code formatting and style
   - Include similar documentation

3. **Test thoroughly** - Run the function to verify:
   - TypeScript compilation succeeds (`npx tsc --noEmit`)
   - All parameters work correctly
   - Error cases are handled gracefully
   - Return values are in the correct format

4. **Move to production** - Once tested and verified, move to `src/functions/`

## Why This Exists

The `src/functions/` directory is actively watched and hot-reloaded by the tool manager. To prevent untested code from being automatically loaded into the active session, we use this staging directory for development and testing.

## Before You Start

**IMPORTANT**: Always read existing production functions first! They are your reference guide.

**Use the Template**:
A template file is provided at `src/test_functions/_template.ts`. You can copy this file to start your new function:
```bash
cp src/test_functions/_template.ts src/test_functions/my_new_function.ts
```

Pick a function similar to what you're building and study it thoroughly - it will serve as your template.

## Structure

Functions here follow the exact same pattern as those in `src/functions/`:
- Single TypeScript file per function
- Implement the `CyraTool` interface matching production examples
- Include proper error handling matching existing patterns
- Follow the code style and conventions of production functions

## Example Workflow

If creating a new `process_data.ts` function:

1. **Start with template**:
   - Copy `_template.ts` to `process_data.ts`
   
2. **Read examples**:
   - Read `/src/functions/execute.ts` to see a basic tool
   - Read `/src/functions/file_operations.ts` to see a more complex one
   - Study the patterns, syntax, and structure

3. **Implement in test**:
   - Modify `/src/test_functions/process_data.ts` 
   - Follow the patterns you learned exactly
   
4. **Test**:
   - Run `npx tsc --noEmit` to verify it compiles
   - Test all code paths work correctly
   
5. **Move to production**:
   - Move to `/src/functions/process_data.ts`
   - The tool manager's hot-reload automatically loads it
   - Function is now available and ready to use

## Notes

- This directory is ignored from hot-reloading
- Functions here are not automatically loaded into the session
- Always test before moving to production
- Always study production functions first before creating new ones
