# Security Review Reference

## OWASP Top 10 (2021)

1. **A01:2021 - Broken Access Control**
2. **A02:2021 - Cryptographic Failures**
3. **A03:2021 - Injection**
4. **A04:2021 - Insecure Design**
5. **A05:2021 - Security Misconfiguration**
6. **A06:2021 - Vulnerable and Outdated Components**
7. **A07:2021 - Identification and Authentication Failures**
8. **A08:2021 - Software and Data Integrity Failures**
9. **A09:2021 - Security Logging and Monitoring Failures**
10. **A10:2021 - Server-Side Request Forgery (SSRF)**

## Common Vulnerability Patterns

### SQL Injection
```sql
-- Vulnerable
query = "SELECT * FROM users WHERE id = " + userId;

-- Safe
query = "SELECT * FROM users WHERE id = ?";
stmt.setString(1, userId);
```

### XSS Prevention
```javascript
// Vulnerable
element.innerHTML = userInput;

// Safe
element.textContent = userInput;
// or use a sanitization library
```

### Command Injection
```python
# Vulnerable
os.system("ls " + user_input)

# Safe
subprocess.run(["ls", user_input], check=True)
```

## Security Headers

### Essential Headers
```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Cryptographic Best Practices

### Password Hashing
- Use bcrypt, scrypt, or Argon2
- Minimum work factor of 10 for bcrypt
- Always use salt

### Encryption
- Use AES-256-GCM for symmetric encryption
- Use RSA-2048 or ECDSA P-256 for asymmetric
- Never roll your own crypto

## Authentication Patterns

### JWT Security
- Use strong signing algorithms (RS256, ES256)
- Short expiration times
- Secure storage on client side
- Proper validation on server side

### Session Management
- Secure, HttpOnly, SameSite cookies
- Session timeout and rotation
- CSRF protection

## Authorization Patterns

### Role-Based Access Control (RBAC)
- Principle of least privilege
- Regular access reviews
- Separation of duties

### Attribute-Based Access Control (ABAC)
- Fine-grained permissions
- Context-aware decisions
- Policy-driven access