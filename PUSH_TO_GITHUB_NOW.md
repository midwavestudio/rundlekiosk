# Push to GitHub - Step by Step

## Step 1: Create Repository on GitHub

1. Go to **https://github.com/new**
2. Repository name: **`rundlekiosk`**
3. Description: `Dual Check-In System for Rundle Suites Hotel - Next.js MVP`
4. Choose **Private** (recommended) or **Public**
5. **DO NOT** check "Initialize with README" (we already have one)
6. Click **Create repository**

## Step 2: Push Your Code

After creating the repository, GitHub will show you commands. Use these instead (they're already set up):

```bash
git remote add origin https://github.com/YOUR_USERNAME/rundlekiosk.git
git branch -M main
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username!**

## Example

If your GitHub username is `johndoe`, the command would be:

```bash
git remote add origin https://github.com/johndoe/rundlekiosk.git
git push -u origin main
```

## Authentication

If prompted for credentials:
- **Username**: Your GitHub username
- **Password**: Use a Personal Access Token (not your password)
  - Go to GitHub Settings → Developer settings → Personal access tokens
  - Generate a token with `repo` permissions
  - Use that token as your password

## Verify Push

After pushing, go to:
**https://github.com/YOUR_USERNAME/rundlekiosk**

You should see all your files!

---

**Ready to push!** Just create the repo on GitHub and run the commands above. 🚀





