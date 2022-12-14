const jwt=require('jsonwebtoken');
const {promisify}=require('util');
const User=require('../model/userModel');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const sendmail=require('../utils/sendEmail');
const crypto=require('crypto');


const createSendToken=(user,statusCode,res)=>{
    const token=jwt.sign({id:user._id},process.env.JWT_KEY,{expiresIn:process.env.JWT_EXPIRE});
    const cookieOptions={
        expires:new Date(Date.now()+30*24*60*60*1000),
        httpOnly:true,
    }
    if(process.env.NODE_ENV=='production') cookieOptions.secure=true
    res.cookie('jwt',token,cookieOptions)
     user.password=undefined
    res.status(statusCode).json({
        status:"Success",
        token,
        data:{
            user
        }
    })
}

exports.signup=catchAsync( async (req,res,next)=>{
    const user=await User.create(req.body);
    createSendToken(user,200,res)
})

exports.login=catchAsync( async(req,res,next)=>{
    //check if password and email exits
    const {email,password}=req.body;
    if(!email || !password){
      return next(new AppError("Please provide email and/or password",404));
    }
    //check if password is and user are correct
    const user=await User.findOne({email}).select('+password');

    if(!user || !await user.correctPassword(password,user.password)){
      return next(new AppError("Invalid Password or Email", 404));
    }
 //Send a success response
    const token=jwt.sign({id:user._id},process.env.JWT_KEY,{expiresIn:process.env.JWT_EXPIRE});
    res.status(200).json({
        status:"Success",
        token,
        message:"Logged In Successfully",
    })
}) 

exports.protect=catchAsync (async(req,res,next)=>{
    //check token if exits and get it
    let token;
    if(req.headers.authorization && req.headers.authorization.startsWith('Bearer')){
        token=req.headers.authorization.split(' ')[1];
    }

    if(!token){
        return next(new AppError("Your not LoggedIn Please log in"))
    }

    //verify Token
    const decode=await promisify(jwt.verify)(token,process.env.JWT_KEY);
    console.log(decode);
    
    //verify if user still exit

    const currentUser=await User.findById(decode.id);
    console.log(currentUser);

    //check if user changed password before JWT token issued
   
    if(!currentUser.changePasswordAt(decode.iat)){
       return next(new AppError("User recently Changed Password Please try log In again",401))
    }

    req.user=currentUser;

    next();
})

exports.restrictTo=(...roles)=>{
    return (req,res,next)=>{
        if(!roles.includes(req.user.role)){
            return next(new AppError("Your not an Admin"));
        }
        
    next();
    }
}

exports.forgotPassword=catchAsync(async(req,res,next)=>{
    //find user by email
    const user=await User.findOne({email:req.body.email});
    if(!user){
        return next(new AppError("There is no user with that email address"));
    }

    //get token
    const token=user.resetPasswordFunctionality();
    await user.save({validateBeforeSave:false});

    const url=`${req.protocol}://${req.get('host')}/api/v1/users/${token}`;
    const message=`Submit new Password to : ${url}`;
     try {
    sendmail({
        email:user.email,
        subject:"Your password reset token valid 10 min",
        message
    })
    res.status(200).json({
        status:"Successfully",
        message:"Reset Url Sent Successfully"
    })

     } catch (error) {
        user.passwordResetToken=undefined,
        user.resetExpires=undefined,

        await user.save({validateBeforeSave:false})

        return next(new AppError("There was an Error sending email", 500));
     }
   
})

exports.resetPassword=catchAsync(async(req,res,next)=>{
    //get user based on token.
    const hashedResetToken=crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user=await User.findOne({passwordResetToken:hashedResetToken,resetExpires:{$gt:Date.now()}});

    //set the new Password if user exits and token not expired.
    if(!user){
        return next(new AppError("User with this token doesn't exit or token expired"))
    }

    user.password=req.body.password;
    user.passwordConfirm=req.body.passwordConfirm;
    user.passwordResetToken=undefined;
    user.resetExpires=undefined;

    await user.save();
    // send new Token and Success response message.
    const token=jwt.sign({id:user._id},process.env.JWT_KEY,{expiresIn:process.env.JWT_EXPIRE});
    res.status(200).json({
        status:"Success",
        token,
        message:"Password Changed/Reset Successfully",
    })
});

exports.updatePassword=catchAsync(async(req,res,next)=>{
    //find user by Id and Password
    const user=await User.findById(req.params.id).select('+password');

    //update the password
    
    if(!(await user.correctPassword(req.body.password, user.password))){
        return next(new AppError("Invalid Id or your current password is wrong"));
    }

    user.password=req.body.password;
    user.passwordConfirm=req.body.passwordConfirm,
    await user.save()

    const token=jwt.sign({id:user._id},process.env.JWT_KEY,{expiresIn:process.env.JWT_EXPIRE});
    res.status(200).json({
        status:"Success",
        token,
        message:"Password Updated Successfully",
    })

})