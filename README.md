# SER 421 - Fall 2016 - Lab 3
Authors:    Kyle Lords, Robbie Buss
Date:       10/29/2016
Instructor: Dr. Gary

Usage:
  - From the command-line/terminal, run `node blog_service.js`
    - A note stating the blog service is running will appear indicating the server has successfully started.
  - Using a browser, navigate to localhost at the specified port

Notes:

// parse header/cookies
// build list of roles
// determine user level
// get target path (routing logic) -- permission check
// build page (user role, target path)
    // get articles
        // list directory
        // return only .art files
    // load header ("top of html")
    // add navigation
    // load page-specific fragments
        { -- only applies to landing page
        // for each article 
            // make list item/hyperlink
            // insert into page
        } (.art file) {
        // construct body of blog
            // reading .art json
            // load fragments 
        } (auth page) {
        // load auth fragment
        }
    // load footer ("bottom of html")
    // build response header
    // send response (res.end?)
