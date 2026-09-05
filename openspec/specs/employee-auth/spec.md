# employee-auth Specification

## Purpose
Who may open the portal and what they may do there: Supabase Auth sessions backed by the `employees` table, the agent and admin roles, and the route guards that separate reading leads from mutating criteria (spec section 5.1).
## Requirements
### Requirement: Portal routes require an authenticated employee
Every route under `/portal` except `/portal/login` SHALL require a valid Supabase Auth session whose user id matches an active row in `employees`; otherwise the request SHALL be redirected to `/portal/login`.

#### Scenario: Anonymous visitor
- **WHEN** an unauthenticated request hits `/portal/leads`
- **THEN** it is redirected to `/portal/login`

#### Scenario: Authenticated employee
- **WHEN** a request carries a valid session for an active employee
- **THEN** the page renders

#### Scenario: Authenticated user with no employee row
- **WHEN** a Supabase user who is not in `employees` signs in
- **THEN** access to `/portal/*` is denied and the login page shows an explanatory error

#### Scenario: Deactivated employee
- **WHEN** an employee with `active = false` has a valid session
- **THEN** access is denied

### Requirement: Login with email and password
The login page SHALL authenticate against Supabase Auth with email and password, show an error on failure, and redirect to `/portal/leads` on success.

#### Scenario: Wrong password
- **WHEN** a user submits a wrong password
- **THEN** an error is shown and no session is created

#### Scenario: Successful login
- **WHEN** a user submits valid credentials
- **THEN** a session cookie is set and the browser is redirected to `/portal/leads`

#### Scenario: Sign out
- **WHEN** an employee clicks sign out
- **THEN** the session is cleared and subsequent `/portal/*` requests redirect to login

### Requirement: Roles come from the employees table
The system SHALL read the role (`agent` or `admin`) from `employees` on every server-side authorisation check, not from client-provided data.

#### Scenario: Role shown in the portal shell
- **WHEN** an admin is signed in
- **THEN** the sidebar shows their name and the `admin` role

#### Scenario: Client cannot elevate role
- **WHEN** a request includes a forged role field in its body
- **THEN** the server ignores it and uses the role from `employees`

### Requirement: Seeded demo accounts
The seed SHALL create one `admin` and one `agent` employee with Supabase Auth users so the demo can be exercised without manual setup.

#### Scenario: Fresh environment
- **WHEN** the seed runs against an empty project
- **THEN** both accounts exist and can sign in

