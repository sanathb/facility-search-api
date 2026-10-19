# Facility Search API - Coding Challenge

## Overview

Build a RESTful API that allows users to search and filter fitness facilities. This challenge is designed to be completed within **2 hours** and focuses on API design, data handling, error handling, testing, and production-readiness considerations.

**Important:** The goal is not necessarily to finish every feature. We understand the requirements are ambitious for 2 hours, and we're most interested in seeing what you prioritise and your approach to problem-solving. We value seeing your API design decisions, code quality, and how you think about production systems. A well-structured, partially complete solution with good fundamentals is better than a rushed, fully complete one.

## Provided Assets

- `assets/facilities.json` - Sample data containing 100 fitness facilities across Sydney and Melbourne
- `assets/auth.ts` - Mock authentication utilities for token verification

## Core Requirements (MVP for 2 hours)

### 1. Search Facilities

- Create a secure endpoint to search facilities by name
- Support real-time/partial matching (e.g., searching "City" should return "City Fitness Central")
- Return facility name and address at minimum
- The API must be performant (designed to handle 100,000+ facilities efficiently)

### 2. Get Facility Details

- Create a secure endpoint to retrieve a single facility by ID
- Return all facility details including:
  - Name
  - Address
  - List of facilities/amenities
  - Location coordinates

### 3. Technical Requirements

- The project must be written in **TypeScript**
- Implement this as you would for a production system

## Stretch Goals (If you have extra time)

- Filter facilities by amenities (e.g., return only facilities with "Pool" or "Sauna")
- Add pagination support for search results
- Add health check endpoint
- Add API documentation (OpenAPI/Swagger)
- Implement rate limiting
- Add caching layer for frequently accessed data

## Getting Started

1. Review the provided assets in the `assets/` folder

2. Design your API structure:

   - What endpoints will you create?
   - What request/response formats will you use?
   - How will you structure your data?

3. Set up your project with your preferred tools and framework

4. Implement your solution

5. Document your API

## Submission

When you're ready to submit:

1. Ensure your code is well-structured and includes comments where helpful
2. Be prepared to discuss your architectural decisions and trade-offs
3. Submit your solution by either:
   - Sharing a link to a public GitHub repository, or
   - Zipping up your project folder and emailing it back to us

Good luck! We look forward to seeing what you build.
