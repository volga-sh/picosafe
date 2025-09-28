# Examples Contribution Guide

## Safe Configuration Principles
- Never present a Safe example where the signature threshold equals the number of owners; a single lost key would brick the account.
- Default to the quorum formula `ceil(number_of_owners / 2)` when choosing a threshold. Show the calculation or reference it in examples when thresholds change.
- Demonstrate governance operations that remediate misconfigured thresholds instead of codifying unsafe defaults.

## Implementation Notes
- Use `withExampleScene` for deterministic test environments and prefer fetching current owners/thresholds with `getOwners` / `getThreshold` before changes.
- Collect signatures from at least the required quorum, optionally more when it clarifies multi-owner participation.
- Keep console output focused on state transitions (owners, threshold, transaction hashes) so readers can follow safety implications quickly.

## Language Guidelines
- Use neutral, descriptive language in all examples - avoid judgmental or prescriptive terms
- Variable names should describe what they contain, not imply correctness or recommendations:
  - ✅ `newThreshold`, `targetThreshold`, `safeDeployment`
  - ❌ `recommendedThreshold`, `correctThreshold`, `misconfiguredSafe`
- Let developers make their own configuration decisions - examples demonstrate capabilities, not best practices
- Focus on what the code does, not why it should be done that way
- Comments should explain mechanics, not advocate for specific approaches

## Example Simplicity
- Examples should demonstrate the happy path without defensive checks or edge case handling
- Avoid unnecessary conditional logic, early returns, or validation
- Trust that examples are configured correctly to showcase the feature
- Remove any code that doesn't directly contribute to demonstrating the SDK functionality
- Examples are teaching tools, not production code - they should be clear and focused
- If an example wouldn't work as written, fix the setup rather than adding defensive code
