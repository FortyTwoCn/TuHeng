// Alias isolates our supported SMTP client from NextAuth v4's unused email-provider peer.
declare module 'tuheng-smtp-client' {
  import nodemailer from 'nodemailer';
  export default nodemailer;
}
