# WynnPages DNS Migration Template: Crazy Domains to Netlify

This guide ensures zero email downtime when transferring domain management to Netlify. 

## STEP 1: Audit Existing Records in Crazy Domains
Before changing any nameservers, log into Crazy Domains and note down the existing MX and TXT records (for email). 

**Example MX Records to copy:**
- `MX | 10 | mx1.crazydomains.com`
- `MX | 20 | mx2.crazydomains.com`

**Example TXT Records (SPF/DKIM):**
- `TXT | @ | v=spf1 include:spf.crazydomains.com ~all`

## STEP 2: Add Domain to Netlify
1. Go to your Netlify Dashboard -> Domains -> Add or register domain.
2. Enter the domain name and click "Verify".
3. Add the domain to your Netlify site.
4. Netlify will prompt you to set up Netlify DNS. Proceed with setup.

## STEP 3: Recreate Email Records in Netlify DNS
**CRITICAL: Do this BEFORE changing the nameservers at Crazy Domains.**

In the Netlify DNS panel for the domain, add all the MX and TXT records you copied from Step 1.
- Type: `MX`
- Name: `@`
- Value: `mx1.crazydomains.com`
- Priority: `10`

(Repeat for all MX and TXT records).

## STEP 4: Update Nameservers at Crazy Domains
Once the Netlify DNS panel has all the necessary A, CNAME, MX, and TXT records:
1. Go back to Crazy Domains.
2. Navigate to Domain Settings -> Name Servers.
3. Select "Custom Name Servers".
4. Replace the existing ones with the 4 Netlify nameservers provided (e.g., `dns1.p01.nsone.net`, etc.).
5. Save changes.

*Propagation can take up to 24-48 hours, but since the Netlify DNS is pre-populated with your email records, your emails will continue to work seamlessly during the switch.*
